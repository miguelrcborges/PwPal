const {test} = require("node:test");
const assert = require("node:assert/strict");
const {readFileSync, existsSync} = require("node:fs");
const {join} = require("node:path");
const vm = require("node:vm");
const {webcrypto} = require("node:crypto");

const root = join(__dirname, "..");
const script = readFileSync(join(root, "main.js"), "utf8");
const html = readFileSync(join(root, "index.html"), "utf8");

function LoadApp(stored = "[]") {
	const elements = {};
	function Element() {
		return {
			value: "", textContent: "", innerHTML: "", hidden: false, disabled: false, required: false,
			listeners: {}, classList: {toggle() {}}, validationMessage: "",
			addEventListener(name, handler) { this.listeners[name] = handler; },
			setCustomValidity(message) { this.validationMessage = message; },
			reportValidity() { return !this.validationMessage && (!this.required || this.value !== ""); },
			focus() {}, setAttribute() {}, click() {}, remove() {},
			showModal() { this.open = true; },
			close() { this.open = false; this.listeners.close?.(); }
		};
	}
	for (const [, id] of html.matchAll(/id="([^"]+)"/g)) elements[id] = Element();
	const fields = ["service_name", "password_length", "extra_characters", "replace_from", "replace_to"];
	elements.source_form.reset = () => {
		for (const field of fields) elements[field].value = field === "password_length" ? "16" : "";
	};
	elements.source_form.reportValidity = () => fields.every(field => elements[field].reportValidity());
	elements.master_password_input.required = true;
	elements.master_password_input.type = "password";
	let fail_writes = false;
	let copied = null;
	const exports = [];
	const context = vm.createContext({
		...elements, TextEncoder, Uint8Array, Blob, crypto: webcrypto, btoa, isSecureContext: true,
		addEventListener() {}, confirm: () => true,
		document: {
			getElementById: id => elements[id] ??= Element(),
			body: {appendChild() {}},
			createElement(tag) {
				if (tag !== "div") return Element();
				return {
					textContent: "",
					get innerHTML() {
						return this.textContent.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
					}
				};
			}
		},
		localStorage: {
			getItem: () => stored,
			setItem(key, value) {
				assert.equal(key, "pwpal-sources");
				if (fail_writes) throw new Error("Storage full");
				stored = value;
			}
		},
		navigator: {clipboard: {writeText: async text => { copied = text; }}},
		URL: {createObjectURL: blob => { exports.push(blob); return "blob:test"; }, revokeObjectURL() {}}
	});
	context.window = context;
	vm.runInContext(script, context);
	return {
		context, elements, exports,
		run: code => vm.runInContext(code, context),
		get stored() { return stored; },
		get copied() { return copied; },
		failWrites() { fail_writes = true; },
		importFile(file) {
			elements.import_file_input.files = [file];
			elements.import_file_input.value = "pwpal_sources.json";
			return elements.import_file_input.listeners.change();
		}
	};
}

test("existing passwords remain byte-for-byte compatible, including the original byte conversion", async () => {
	const app = LoadApp();
	const cases = [
		["correct horse battery staple", ["example.com", 16], "vd4ocnygpBJkvDKS"],
		["master", ["GitHub", 8], "xTOBXiB4"],
		["master", ["GitHub", 39], "A6bdxXulHKyKH80xTOBXiB4FiMP1ha44yaZV3vC"],
		["master", ["GitHub", 40], "QA6bdxXulHKyKH80xTOBXiB4FiMP1ha44yaZV3vC"],
		["p\u00e4ss\u{1f511}", ["\u4f8b\u3048.com", 17], "YGTt3Vs1QO3yHCra0"]
	];
	for (const [master, source, expected] of cases) {
		assert.equal(await app.run(`GeneratePassword(${JSON.stringify(master)}, ${JSON.stringify(source)})`), expected);
	}
	assert.equal(await app.run('GeneratePassword("master", ["GitHub", 8, "", "", ""])'), "xTOBXiB4");
});

test("rules replace every literal occurrence before appending the unchanged suffix", async () => {
	const app = LoadApp();
	assert.equal(await app.run('GeneratePassword("master65", ["example.com", 16, "/!", "/", "-"])'), "9a0g3q7u-cG16X-K/!");
	assert.equal(await app.run('GeneratePassword("master65", ["example.com", 16, "", "/", "$"])'), "9a0g3q7u$cG16X$K");
	assert.equal(await app.run('GeneratePassword("master65", ["example.com", 16, "!9"])'), "9a0g3q7u/cG16X/K!9");
});

test("multiple symbols map by position in one pass, leaving appended characters unchanged", async () => {
	const app = LoadApp();
	assert.equal(await app.run('GeneratePassword("master65", ["example.com", 16, "/9", "9/", "/9"])'), "/a0g3q7u9cG16X9K/9");
	app.run('HashInput = async () => "x".repeat(14) + "+/==+/AB+/==+/AB"');
	assert.equal(await app.run('GeneratePassword("master", ["example.com", 16, "+/=", "+/=", "-_!"])'), "-_!!-_AB-_!!-_AB+/=");
	assert.equal(await app.run('GeneratePassword("master", ["example.com", 16, "", "+/", "/+"])'), "/+==/+AB/+==/+AB");
});

test("replacement characters are Unicode code points, not UTF-16 halves", async () => {
	const app = LoadApp();
	assert.equal(await app.run('GeneratePassword("master65", ["example.com", 16, "/!", "/9", "🔒💡"])'), "💡a0g3q7u🔒cG16X🔒K/!");
});

test("filtering keeps the original provider indices and escapes names", () => {
	const app = LoadApp(JSON.stringify([["Alpha", 16], ["<Beta>", 20]]));
	app.elements.sources_filter_input.value = "beta";
	app.run("RenderSourcesList()");
	const rendered = app.elements.sources_container.innerHTML;
	assert.match(rendered, /OpenSource\(1\)/);
	assert.match(rendered, /CopyPassword\(1\)/);
	assert.doesNotMatch(rendered, /CopyPassword\(0\)/);
	assert.match(rendered, /&lt;Beta&gt;/);
	assert.doesNotMatch(rendered, /<Beta>/);
	app.run("OpenSource(1)");
	assert.equal(app.elements.service_name.value, "<Beta>");
	app.run("DeleteSource(1)");
	assert.deepEqual(JSON.parse(app.stored), [["Alpha", 16]]);
});

test("editing saves all rules without losing other providers, and rules survive reload", async () => {
	const app = LoadApp('[["Alpha",16],["example.com",16]]');
	app.run("OpenSource(1)");
	app.elements.extra_characters.value = "/!";
	app.elements.replace_from.value = "/";
	app.elements.replace_to.value = "-";
	app.run("SaveSource({preventDefault() {}})");
	assert.deepEqual(JSON.parse(app.stored), [["Alpha", 16], ["example.com", 16, "/!", "/", "-"]]);
	assert.equal(app.elements.new_entry_dialog.open, false);
	const reloaded = LoadApp(app.stored);
	assert.equal(await reloaded.run('GeneratePassword("master65", sources[1])'), "9a0g3q7u-cG16X-K/!");
});

test("adding a provider sorts it, and cancellation does not save changes", () => {
	const app = LoadApp('[["Zulu",16]]');
	app.run("OpenSource()");
	app.elements.service_name.value = "Alpha";
	app.run("SaveSource({preventDefault() {}})");
	assert.deepEqual(JSON.parse(app.stored), [["Alpha", 16, "", "", ""], ["Zulu", 16]]);
	app.run("OpenSource(0)");
	app.elements.service_name.value = "Changed";
	app.elements.cancel_source_btn.listeners.click();
	assert.equal(JSON.parse(app.stored)[0][0], "Alpha");
});

test("replacement fields require each other, and invalid stored settings are rejected", () => {
	const app = LoadApp();
	app.elements.replace_from.value = "/";
	app.run("ValidateReplacement()");
	assert.equal(app.elements.replace_to.required, true);
	app.elements.replace_from.value = "";
	app.elements.replace_to.value = "-";
	app.run("ValidateReplacement()");
	assert.equal(app.elements.replace_from.required, true);
	for (const source of [null, {}, ["name", 7], ["name", 41], ["name", 16.5], ["name", 16, {}, "", ""],
		["name", 16, "", "/", ""], ["name", 16, "", "ab", "-"], ["name", 16, "", "", "ab"],
		["name", 16, "", "//", "ab"], ["name", 16, "", "🔒🔒", "ab"]]) {
		assert.equal(app.run(`IsValidSource(${JSON.stringify(source)})`), false);
	}
	for (const source of [["name", 16, "", "+/=", "-_!"], ["name", 16, "", "+/=", "---"], ["name", 16, "", "/", "🔒"]]) {
		assert.equal(app.run(`IsValidSource(${JSON.stringify(source)})`), true);
	}
	assert.equal(app.run('IsValidSource(["", 16])'), true); // Legacy entries could have empty names.
});

test("replacement validation blocks mismatched or ambiguous pairs and clears errors as they are corrected", () => {
	const original = '[["example.com",16]]';
	const app = LoadApp(original);
	app.run("OpenSource(0)");
	app.elements.replace_from.value = "+/";
	app.elements.replace_to.value = "-";
	app.elements.replace_to.listeners.input();
	assert.match(app.elements.replace_to.validationMessage, /same number/);
	app.run("SaveSource({preventDefault() {}})");
	assert.equal(app.stored, original);
	app.elements.replace_from.value = "++";
	app.elements.replace_to.value = "-_";
	app.elements.replace_from.listeners.input();
	assert.match(app.elements.replace_from.validationMessage, /only once/);
	app.run("SaveSource({preventDefault() {}})");
	assert.equal(app.stored, original);
	app.elements.replace_from.value = "+/";
	app.elements.replace_from.listeners.input();
	assert.equal(app.elements.replace_from.validationMessage, "");
	assert.equal(app.elements.replace_to.validationMessage, "");
	app.run("SaveSource({preventDefault() {}})");
	assert.deepEqual(JSON.parse(app.stored), [["example.com", 16, "", "+/", "-_"]]);
	app.run("OpenSource()");
	assert.equal(app.elements.replace_from.validationMessage, "");
	assert.equal(app.elements.replace_to.validationMessage, "");
});

test("multi-symbol settings survive editing, export, import, and reload without changing their result", async () => {
	const app = LoadApp('[["example.com",16]]');
	app.run("OpenSource(0)");
	app.elements.replace_from.value = "9/";
	app.elements.replace_to.value = "/9";
	app.elements.extra_characters.value = "/9";
	app.run("SaveSource({preventDefault() {}})");
	app.run("ExportSources()");
	const imported = LoadApp();
	await imported.importFile(app.exports[0]);
	assert.deepEqual(JSON.parse(imported.stored), [["example.com", 16, "/9", "9/", "/9"]]);
	const reloaded = LoadApp(imported.stored);
	assert.equal(await reloaded.run('GeneratePassword("master65", sources[0])'), "/a0g3q7u9cG16X9K/9");
});

test("storage failures leave both saved data and the in-memory providers unchanged", () => {
	const original = '[["Alpha",16]]';
	const app = LoadApp(original);
	app.failWrites();
	app.run("OpenSource(0)");
	app.elements.extra_characters.value = "!";
	app.run("SaveSource({preventDefault() {}})");
	assert.equal(app.stored, original);
	assert.equal(app.run("JSON.stringify(sources)"), original);
	assert.equal(app.elements.new_entry_dialog.open, true);
	assert.match(app.elements.status_message.textContent, /nothing was changed/);
	assert.match(app.elements.dialog_status.textContent, /nothing was changed/);
	assert.equal(app.elements.dialog_status.hidden, false);
});

test("corrupt data is never overwritten and can still be exported as a backup", async () => {
	const app = LoadApp("{broken");
	app.run('SaveSources([["New",16]])');
	assert.equal(app.stored, "{broken");
	app.run("ExportSources()");
	assert.equal(await app.exports[0].text(), "{broken");
});

test("import merges a real export with legacy and custom rules without changing passwords", async () => {
	const original = LoadApp('[["example.com",16,"/!","/","-"],["Alpha",20]]');
	original.run("ExportSources()");
	const app = LoadApp('[["Zulu",8]]');
	await app.importFile(original.exports[0]);
	assert.deepEqual(JSON.parse(app.stored), [["Alpha", 20], ["example.com", 16, "/!", "/", "-"], ["Zulu", 8]]);
	const reloaded = LoadApp(app.stored);
	assert.equal(await reloaded.run('GeneratePassword("master65", sources[1])'), "9a0g3q7u-cG16X-K/!");
	assert.equal(app.elements.import_file_input.value, "");
	assert.equal(app.elements.import_btn.disabled, false);
	assert.match(app.elements.status_message.textContent, /2 providers imported/);
});

test("import skips equivalent legacy records and repeated entries but preserves different settings and name case", async () => {
	const app = LoadApp('[["Alpha",16]]');
	const file = new Blob(['[["Alpha",16,"","",""],["Beta",16],["Beta",16],["Alpha",16,"!"],["alpha",16]]']);
	await app.importFile(file);
	const saved = JSON.parse(app.stored);
	assert.equal(saved.length, 4);
	assert.equal(saved.filter(source => source[0] === "Beta").length, 1);
	assert.ok(saved.some(source => source[0] === "Alpha" && source[2] === "!"));
	assert.ok(saved.some(source => source[0] === "alpha"));
	assert.ok(saved.some(source => source[0] === "Alpha" && source.length === 2));
	const stored = app.stored;
	await app.importFile(file);
	assert.equal(app.stored, stored);
	assert.match(app.elements.status_message.textContent, /No new providers/);
});

test("invalid imports are rejected as a whole without saving partially valid entries", async () => {
	for (const data of ["{broken", "{}", "[null]", '[["New",16],["Bad",41]]', '[["New",16],["Bad",16,"","/",""]]',
		'[["New",16],["Bad",16,"","+/","-"]]', '[["New",16],["Bad",16,"","++","-_"]]']) {
		const original = '[["Existing",16]]';
		const app = LoadApp(original);
		await app.importFile(new Blob([data]));
		assert.equal(app.stored, original);
		assert.equal(app.run("JSON.stringify(sources)"), original);
		assert.match(app.elements.status_message.textContent, /No providers were changed/);
		assert.equal(app.elements.import_file_input.value, "");
		assert.equal(app.elements.import_btn.disabled, false);
	}
});

test("unreadable files and storage failures leave existing providers unchanged and allow retrying", async () => {
	const original = '[["Existing",16]]';
	const app = LoadApp(original);
	await app.importFile({text: async () => { throw new Error("Read failed"); }});
	assert.equal(app.stored, original);
	assert.equal(app.elements.import_btn.disabled, false);
	app.failWrites();
	await app.importFile(new Blob(['[["New",16]]']));
	assert.equal(app.stored, original);
	assert.equal(app.run("JSON.stringify(sources)"), original);
	assert.match(app.elements.status_message.textContent, /nothing was changed/);
	assert.equal(app.elements.import_btn.disabled, false);
});

test("import cannot overwrite corrupt browser storage", async () => {
	const app = LoadApp("{broken");
	await app.importFile(new Blob(['[["New",16]]']));
	assert.equal(app.stored, "{broken");
	assert.match(app.elements.status_message.textContent, /could not be loaded/);
});

test("an edit opened while the file is being read still targets the same provider after import sorts the list", async () => {
	const app = LoadApp('[["Zulu",16]]');
	let finish_reading;
	const importing = app.importFile({text: () => new Promise(resolve => { finish_reading = resolve; })});
	app.run("OpenSource(0)");
	app.elements.extra_characters.value = "!";
	finish_reading('[["Alpha",16]]');
	await importing;
	app.run("SaveSource({preventDefault() {}})");
	assert.deepEqual(JSON.parse(app.stored), [["Alpha", 16], ["Zulu", 16, "!", "", ""]]);
});

test("the import button opens the picker, and cancellation or an empty list does not change saved data", async () => {
	const original = '[["Existing",16]]';
	const app = LoadApp(original);
	let opened = false;
	app.elements.import_file_input.click = () => { opened = true; };
	app.elements.import_btn.listeners.click();
	assert.equal(opened, true);
	app.elements.import_file_input.files = [];
	await app.elements.import_file_input.listeners.change();
	assert.equal(app.stored, original);
	await app.importFile(new Blob(["[]"]));
	assert.equal(app.stored, original);
	assert.match(app.elements.status_message.textContent, /No new providers/);
});

test("copy requires a master password, copies the selected provider, and never saves the master", async () => {
	const original = '[["example.com",16,"!"]]';
	const app = LoadApp(original);
	await app.run("CopyPassword(0)");
	assert.equal(app.copied, null);
	app.elements.master_password_input.value = "correct horse battery staple";
	await app.run("CopyPassword(0)");
	assert.equal(app.copied, "vd4ocnygpBJkvDKS!");
	assert.equal(app.stored, original);
	assert.equal(app.elements["copy-0"].disabled, false);
});

test("the Safari clipboard request starts synchronously, before hashing finishes", async () => {
	const app = LoadApp('[["example.com",16]]');
	app.elements.master_password_input.value = "correct horse battery staple";
	app.context.ClipboardItem = class { constructor(items) { this.items = items; } };
	let started = false;
	let copied;
	app.context.navigator.clipboard.write = async ([item]) => {
		started = true;
		copied = await (await item.items["text/plain"]).text();
	};
	const copying = app.run("CopyPassword(0)");
	assert.equal(started, true);
	await copying;
	assert.equal(copied, "vd4ocnygpBJkvDKS");
});

test("clipboard errors are reported and the copy button is re-enabled", async () => {
	const app = LoadApp('[["example.com",16]]');
	app.elements.master_password_input.value = "master";
	app.context.navigator.clipboard.writeText = async () => { throw new Error("Permission denied"); };
	await app.run("CopyPassword(0)");
	assert.match(app.elements.status_message.textContent, /Could not copy/);
	assert.equal(app.elements["copy-0"].disabled, false);
});

test("missing crypto and clipboard APIs fail cleanly without an unhandled hash rejection", async () => {
	const app = LoadApp('[["example.com",16]]');
	app.elements.master_password_input.value = "master";
	app.context.crypto = {};
	app.context.navigator.clipboard = undefined;
	await app.run("CopyPassword(0)");
	assert.match(app.elements.status_message.textContent, /Could not copy/);
	assert.equal(app.elements["copy-0"].disabled, false);
});

test("the offline shell includes existing files under a subdirectory and install icons have correct sizes", async () => {
	const events = {};
	let shell;
	let matched;
	let claimed = false;
	const deleted = [];
	const cache = {
		addAll: async urls => { shell = urls; },
		match: async request => { matched = request; return "cached response"; }
	};
	const context = vm.createContext({
		URL, self: {
			location: {href: "https://example.com/pwpal/sw.js"},
			addEventListener: (name, handler) => { events[name] = handler; },
			clients: {claim: async () => { claimed = true; }}
		},
		caches: {
			open: async () => cache,
			keys: async () => ["pwpal-v2", "pwpal-v3", "another-app"],
			delete: async key => { deleted.push(key); }
		}
	});
	vm.runInContext(readFileSync(join(root, "sw.js"), "utf8"), context);
	await new Promise((resolve, reject) => events.install({waitUntil: promise => promise.then(resolve, reject)}));
	for (const url of shell) {
		assert.ok(url.startsWith("https://example.com/pwpal/"));
		assert.ok(existsSync(join(root, new URL(url).pathname.slice("/pwpal/".length))));
	}
	const manifest = JSON.parse(readFileSync(join(root, "manifest.webmanifest"), "utf8"));
	assert.equal(manifest.start_url, "./");
	assert.equal(manifest.display, "standalone");
	for (const icon of manifest.icons) {
		const png = readFileSync(join(root, icon.src));
		assert.equal(`${png.readUInt32BE(16)}x${png.readUInt32BE(20)}`, icon.sizes);
		assert.ok(shell.some(url => url.endsWith(icon.src)));
	}
	await new Promise((resolve, reject) => events.activate({waitUntil: promise => promise.then(resolve, reject)}));
	assert.deepEqual(deleted, ["pwpal-v2"]);
	assert.equal(claimed, true);
	let response;
	events.fetch({
		request: {method: "GET", mode: "navigate", url: "https://example.com/pwpal/"},
		respondWith: promise => { response = promise; }
	});
	assert.equal(await response, "cached response");
	assert.equal(matched, "https://example.com/pwpal/index.html");
	const asset = {method: "GET", mode: "cors", url: shell[3]};
	events.fetch({request: asset, respondWith: promise => { response = promise; }});
	assert.equal(await response, "cached response");
	assert.equal(matched, asset);
	for (const request of [
		{method: "POST", mode: "navigate", url: shell[0]},
		{method: "GET", mode: "cors", url: "https://other.example/data"}
	]) {
		events.fetch({request, respondWith() { assert.fail("Unrelated requests must not be intercepted"); }});
	}
});
