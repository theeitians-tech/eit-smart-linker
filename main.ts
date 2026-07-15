import { App, Modal, Notice, Plugin, TFile } from "obsidian";

// ---------- Types ----------

interface AliasCandidate {
	file: TFile;
	alias: string;
}

interface MatchOption {
	file: TFile;
	alias: string;
}

interface LinkChange {
	sourceFile: TFile;
	start: number;
	end: number;
	matchedText: string;
	options: MatchOption[];
	selected: number; // index into options
	include: boolean;
}

const FRONTMATTER_RE = /^---\n[\s\S]*?\n---\n?/;
const CODE_BLOCK_RE = /```[\s\S]*?```/g;
const INLINE_CODE_RE = /`[^`\n]*`/g;
const WIKILINK_RE = /\[\[[^\]]*\]\]/g;

// ---------- Plugin ----------

export default class EitSmartLinkerPlugin extends Plugin {
	async onload() {
		this.addCommand({
			id: "suggest-aliases-current-file",
			name: "Suggest Aliases: Current File",
			checkCallback: (checking: boolean) => {
				const file = this.app.workspace.getActiveFile();
				if (!file || file.extension !== "md") return false;
				if (!checking) {
					new AliasSuggestModal(this.app, [file]).open();
				}
				return true;
			},
		});

		this.addCommand({
			id: "suggest-aliases-vault",
			name: "Suggest Aliases: All Files Missing Aliases",
			callback: () => {
				const files = this.app.vault.getMarkdownFiles().filter((f) => {
					const cache = this.app.metadataCache.getFileCache(f);
					const aliases = cache?.frontmatter?.aliases;
					return !aliases || (Array.isArray(aliases) && aliases.length === 0);
				});
				if (files.length === 0) {
					new Notice("No files are missing aliases.");
					return;
				}
				new AliasSuggestModal(this.app, files).open();
			},
		});

		this.addCommand({
			id: "smart-link-current-file",
			name: "Smart Link: Current File",
			checkCallback: (checking: boolean) => {
				const file = this.app.workspace.getActiveFile();
				if (!file || file.extension !== "md") return false;
				if (!checking) {
					this.runSmartLink([file]);
				}
				return true;
			},
		});

		this.addCommand({
			id: "smart-link-vault",
			name: "Smart Link: Entire Vault",
			callback: () => {
				this.runSmartLink(this.app.vault.getMarkdownFiles());
			},
		});
	}

	async runSmartLink(targetFiles: TFile[]) {
		const allFiles = this.app.vault.getMarkdownFiles();
		const index = this.buildIndex(allFiles);

		let allChanges: LinkChange[] = [];
		for (const file of targetFiles) {
			const content = await this.app.vault.read(file);
			const changes = this.findMatches(file, content, index);
			allChanges = allChanges.concat(changes);
		}

		if (allChanges.length === 0) {
			new Notice("No new links found.");
			return;
		}

		new LinkPreviewModal(this.app, allChanges).open();
	}

	// Builds a lookup of every matchable string (filename + frontmatter aliases)
	// to the file(s) it could point to.
	buildIndex(files: TFile[]): Map<string, AliasCandidate[]> {
		const index = new Map<string, AliasCandidate[]>();

		const addCandidate = (str: string, file: TFile, alias: string) => {
			const trimmed = str.trim();
			if (!trimmed) return;
			const existing = index.get(trimmed) ?? [];
			if (!existing.some((c) => c.file.path === file.path)) {
				existing.push({ file, alias });
			}
			index.set(trimmed, existing);
		};

		for (const file of files) {
			addCandidate(file.basename, file, file.basename);

			const cache = this.app.metadataCache.getFileCache(file);
			const aliases = cache?.frontmatter?.aliases;
			if (Array.isArray(aliases)) {
				for (const a of aliases) {
					if (typeof a === "string") {
						addCandidate(a, file, a);
					}
				}
			}
		}

		return index;
	}

	// Scans raw file content for candidate strings, skipping frontmatter,
	// code blocks, inline code, and text already inside a wikilink.
	findMatches(
		sourceFile: TFile,
		content: string,
		index: Map<string, AliasCandidate[]>
	): LinkChange[] {
		const excluded: [number, number][] = [];

		const fmMatch = content.match(FRONTMATTER_RE);
		if (fmMatch) {
			excluded.push([0, fmMatch[0].length]);
		}

		for (const re of [CODE_BLOCK_RE, INLINE_CODE_RE, WIKILINK_RE]) {
			re.lastIndex = 0;
			let m: RegExpExecArray | null;
			while ((m = re.exec(content)) !== null) {
				excluded.push([m.index, m.index + m[0].length]);
			}
		}

		const isExcluded = (pos: number) =>
			excluded.some(([s, e]) => pos >= s && pos < e);

		// Longest candidates first, so "Amp Rhythmax" claims its span before "Amp" tries to.
		const candidates = Array.from(index.keys()).sort(
			(a, b) => b.length - a.length
		);

		const claimed: [number, number][] = [];
		const overlaps = (s: number, e: number) =>
			claimed.some(([cs, ce]) => s < ce && e > cs);

		const changes: LinkChange[] = [];

		for (const candidate of candidates) {
			const options = (index.get(candidate) ?? []).filter(
				(c) => c.file.path !== sourceFile.path
			);
			if (options.length === 0) continue;

			const escaped = candidate.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
			const re = new RegExp(`\\b${escaped}\\b`, "g");
			let m: RegExpExecArray | null;
			while ((m = re.exec(content)) !== null) {
				const start = m.index;
				const end = start + m[0].length;
				if (isExcluded(start) || overlaps(start, end)) continue;

				claimed.push([start, end]);
				changes.push({
					sourceFile,
					start,
					end,
					matchedText: m[0],
					options,
					selected: 0,
					include: true,
				});
			}
		}

		changes.sort((a, b) => a.start - b.start);
		return changes;
	}
}

// ---------- Alias Suggest Modal ----------
// Walks through files missing aliases (or a single file), proposes token
// splits of the filename, and lets the user edit/confirm before writing
// to frontmatter.

class AliasSuggestModal extends Modal {
	files: TFile[];
	index: number;

	constructor(app: App, files: TFile[]) {
		super(app);
		this.files = files;
		this.index = 0;
	}

	onOpen() {
		this.render();
	}

	async render() {
		const { contentEl } = this;
		contentEl.empty();

		const file = this.files[this.index];
		if (!file) {
			contentEl.createEl("p", { text: "Done — no more files to review." });
			return;
		}

		contentEl.createEl("h2", {
			text: `Suggest Aliases (${this.index + 1} of ${this.files.length})`,
		});
		contentEl.createEl("p", { text: file.basename });

		const cache = this.app.metadataCache.getFileCache(file);
		const existingAliases: string[] = Array.isArray(cache?.frontmatter?.aliases)
			? (cache!.frontmatter!.aliases as string[])
			: [];

		const suggested = this.suggestTokens(file.basename);
		const combined = Array.from(new Set([...existingAliases, ...suggested]));

		contentEl.createEl("p", {
			text: "One alias per line. Edit freely — add true nicknames, remove anything that doesn't apply.",
			attr: { style: "font-size: 0.85em; color: var(--text-muted);" },
		});

		const textarea = contentEl.createEl("textarea", {
			attr: { rows: "8", style: "width: 100%;" },
		});
		textarea.value = combined.join("\n");

		const buttonRow = contentEl.createDiv({
			attr: { style: "margin-top: 10px; display: flex; gap: 8px;" },
		});

		const saveBtn = buttonRow.createEl("button", { text: "Save & Next" });
		saveBtn.onclick = async () => {
			const lines = textarea.value
				.split("\n")
				.map((l) => l.trim())
				.filter((l) => l.length > 0);
			await this.app.fileManager.processFrontMatter(file, (fm) => {
				fm.aliases = lines;
			});
			new Notice(`Saved aliases for ${file.basename}`);
			this.index++;
			this.render();
		};

		const skipBtn = buttonRow.createEl("button", { text: "Skip" });
		skipBtn.onclick = () => {
			this.index++;
			this.render();
		};

		const closeBtn = buttonRow.createEl("button", { text: "Close" });
		closeBtn.onclick = () => this.close();
	}

	suggestTokens(basename: string): string[] {
		const words = basename.split(/\s+/).filter((w) => w.length > 0);
		const tokens = new Set<string>();
		if (words.length > 1) {
			tokens.add(words[0]);
			tokens.add(words[words.length - 1]);
		}
		return Array.from(tokens).filter((t) => t !== basename);
	}

	onClose() {
		this.contentEl.empty();
	}
}

// ---------- Link Preview Modal ----------
// Shows every proposed [[Target|Alias]] replacement, grouped by source file.
// Ambiguous matches get an inline dropdown. Nothing is written until Apply.

class LinkPreviewModal extends Modal {
	changes: LinkChange[];

	constructor(app: App, changes: LinkChange[]) {
		super(app);
		this.changes = changes;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl("h2", { text: "Smart Link Preview" });
		contentEl.createEl("p", {
			text: `${this.changes.length} potential link(s) found. Uncheck any you don't want, resolve ambiguous matches, then Apply.`,
		});

		const bySource = new Map<string, LinkChange[]>();
		for (const c of this.changes) {
			const list = bySource.get(c.sourceFile.path) ?? [];
			list.push(c);
			bySource.set(c.sourceFile.path, list);
		}

		const listEl = contentEl.createDiv({
			attr: {
				style: "max-height: 400px; overflow-y: auto; margin-bottom: 10px;",
			},
		});

		for (const [path, changes] of bySource) {
			listEl.createEl("h3", { text: path });
			for (const change of changes) {
				const row = listEl.createDiv({
					attr: {
						style:
							"display: flex; align-items: center; gap: 8px; margin-bottom: 6px; padding: 4px; border-bottom: 1px solid var(--background-modifier-border);",
					},
				});

				const checkbox = row.createEl("input", { attr: { type: "checkbox" } });
				checkbox.checked = change.include;
				checkbox.onchange = () => {
					change.include = checkbox.checked;
				};

				row.createEl("span", { text: `"${change.matchedText}" →` });

				if (change.options.length > 1) {
					const select = row.createEl("select");
					change.options.forEach((opt, i) => {
						const optionEl = select.createEl("option", {
							text: `${opt.file.basename} (as "${opt.alias}")`,
						});
						optionEl.value = String(i);
					});
					select.value = String(change.selected);
					select.onchange = () => {
						change.selected = Number(select.value);
					};
				} else {
					const opt = change.options[0];
					row.createEl("span", {
						text: `[[${opt.file.basename}|${opt.alias}]]`,
					});
				}
			}
		}

		const buttonRow = contentEl.createDiv({
			attr: { style: "display: flex; gap: 8px;" },
		});

		const applyBtn = buttonRow.createEl("button", { text: "Apply Selected" });
		applyBtn.onclick = async () => {
			await this.applyChanges();
			this.close();
		};

		const cancelBtn = buttonRow.createEl("button", { text: "Cancel" });
		cancelBtn.onclick = () => this.close();
	}

	async applyChanges() {
		const bySource = new Map<string, LinkChange[]>();
		for (const c of this.changes) {
			if (!c.include) continue;
			const list = bySource.get(c.sourceFile.path) ?? [];
			list.push(c);
			bySource.set(c.sourceFile.path, list);
		}

		let filesModified = 0;
		let linksAdded = 0;

		for (const [, changes] of bySource) {
			const file = changes[0].sourceFile;
			let content = await this.app.vault.read(file);

			// Apply in reverse order so earlier offsets stay valid.
			const sorted = [...changes].sort((a, b) => b.start - a.start);
			for (const change of sorted) {
				const opt = change.options[change.selected];
				const replacement = `[[${opt.file.basename}|${opt.alias}]]`;
				content =
					content.slice(0, change.start) + replacement + content.slice(change.end);
				linksAdded++;
			}

			await this.app.vault.modify(file, content);
			filesModified++;
		}

		new Notice(`Applied ${linksAdded} link(s) across ${filesModified} file(s).`);
	}

	onClose() {
		this.contentEl.empty();
	}
}
