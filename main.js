const encoder = new TextEncoder();
const local_storage_sources_location = "pwpal-sources";
const safe_text_element = document.createElement("div");
let sources = [];
let storage_loaded = false;
let editing_source = null;
let install_prompt = null;

function EscapeString(s) {
	safe_text_element.textContent = s;
	return safe_text_element.innerHTML;
}

function ShowStatus(message, error = false) {
	status_message.textContent = message;
	status_message.classList.toggle("error", error);
	if (new_entry_dialog.open) {
		dialog_status.textContent = error ? message : "";
		dialog_status.hidden = !error;
	}
}

function IsValidSource(source) {
	if (!Array.isArray(source) || source.length < 2 || source.length > 5) return false;
	const [name, length, suffix = "", from = "", to = ""] = source;
	return typeof name === "string" && Number.isInteger(length) && length >= 8 && length <= 40
		&& typeof suffix === "string" && typeof from === "string" && typeof to === "string"
		&& from.length <= 1 && to.length <= 1 && Boolean(from) === Boolean(to);
}

function RenderSourcesList() {
	const filter = sources_filter_input.value.toUpperCase();
	const sources_html = sources.map((p, i) => {
		if (!p[0].toUpperCase().includes(filter)) return "";
		return `<article class="password-source" aria-labelledby="provider-${i}">
			<div class="provider-info">
				<span class="provider-mark" aria-hidden="true">${EscapeString(Array.from(p[0])[0]?.toUpperCase() || "?")}</span>
				<div class="provider-name">
					<h3 id="provider-${i}">${EscapeString(p[0] || "(unnamed provider)")}</h3>
					<p>${p[1]} base characters${p[2] || p[3] ? " · custom rules" : ""}</p>
				</div>
			</div>
			<div class="inline-buttons">
				<button type="button" onclick="OpenSource(${i})" class="secondary-btn" aria-labelledby="edit-label-${i} provider-${i}"><span id="edit-label-${i}">Edit</span></button>
				<button type="button" id="copy-${i}" onclick="CopyPassword(${i})" class="primary-btn" aria-labelledby="copy-label-${i} provider-${i}"><span id="copy-label-${i}">Copy</span></button>
			</div>
		</article>`;
	}).join("");
	sources_count.textContent = sources.length;
	sources_container.innerHTML = sources_html || `<div class="empty-state">
		<h3>${sources.length ? "No matching providers" : "Your next password starts here"}</h3>
		<p>${sources.length ? "Try a different search." : "Add a provider, then tap Copy to recreate its password."}</p>
	</div>`;
}

function SaveSources(next_sources) {
	if (!storage_loaded) {
		ShowStatus("Saved providers could not be loaded. Export a backup and reload before making changes.", true);
		return false;
	}
	try {
		localStorage.setItem(local_storage_sources_location, JSON.stringify(next_sources));
	} catch {
		ShowStatus("Could not save providers. Check that browser storage is available; nothing was changed.", true);
		return false;
	}
	sources = next_sources;
	RenderSourcesList();
	return true;
}

function OpenSource(i = null) {
	editing_source = i;
	source_form.reset();
	dialog_status.hidden = true;
	if (i !== null) {
		const [name, length, suffix = "", from = "", to = ""] = sources[i];
		service_name.value = name;
		password_length.value = length;
		extra_characters.value = suffix;
		replace_from.value = from;
		replace_to.value = to;
	}
	ValidateReplacement();
	dialog_title.textContent = i === null ? "Add provider" : "Edit provider";
	delete_source_btn.hidden = i === null;
	new_entry_dialog.showModal();
}

function ValidateReplacement() {
	replace_from.required = replace_to.value !== "";
	replace_to.required = replace_from.value !== "";
}

function SaveSource(event) {
	event.preventDefault();
	ValidateReplacement();
	if (!source_form.reportValidity()) return;
	const source = [service_name.value, Number(password_length.value),
		extra_characters.value, replace_from.value, replace_to.value];
	if (!IsValidSource(source)) {
		ShowStatus("Check the provider settings. A replacement must be one character in each field.", true);
		return;
	}
	const next_sources = sources.slice();
	if (editing_source === null) next_sources.push(source);
	else next_sources[editing_source] = source;
	next_sources.sort((s1, s2) => s1[0].toUpperCase() < s2[0].toUpperCase() ? -1 : 1);
	if (SaveSources(next_sources)) {
		new_entry_dialog.close();
		ShowStatus("Provider saved. Use these same settings to recreate its password.");
	}
}

function DeleteSource(i) {
	if (!window.confirm(`Delete "${sources[i][0]}"? Export a backup first if you might need these settings again.`)) return;
	if (SaveSources(sources.filter((_, index) => index !== i))) {
		new_entry_dialog.close();
		ShowStatus("Provider deleted.");
	}
}

async function GeneratePassword(master_password, source) {
	const [name, length, suffix = "", from = "", to = ""] = source;
	const hash = await HashInput(master_password + name);
	const start = 22 - (length >> 1);
	const password = hash.slice(start, start + length);
	return (from ? password.replaceAll(from, to) : password) + suffix;
}

async function CopyPassword(i) {
	if (!master_password_input.reportValidity()) {
		ShowStatus("Enter your master password first.", true);
		master_password_input.focus();
		return;
	}
	const source = sources[i];
	const button = document.getElementById(`copy-${i}`);
	button.disabled = true;
	try {
		const password = GeneratePassword(master_password_input.value, source);
		if (typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
			// Safari needs the clipboard request inside the tap, before hashing finishes.
			await navigator.clipboard.write([new ClipboardItem({
				"text/plain": password.then(text => new Blob([text], {type: "text/plain"}))
			})]);
		} else {
			const text = await password;
			await navigator.clipboard.writeText(text);
		}
		ShowStatus(`Password copied for ${source[0]}.`);
	} catch {
		ShowStatus("Could not copy. Use HTTPS or localhost and allow clipboard access, then try again.", true);
	} finally {
		button.disabled = false;
	}
}

async function HashInput(input) {
	const data = encoder.encode(input);
	const hash = await window.crypto.subtle.digest("SHA-256", data);
	const hash_viewer = new Uint8Array(hash);
	// Preserve the original byte conversion exactly: correcting it changes existing passwords.
	const bytes_str = hash_viewer.reduce((acc, c) => acc + String.fromCharCode(c));
	return window.btoa(bytes_str);
}

function ExportSources() {
	try {
		// Export the original data even if loading failed, so a backup is still possible.
		const data = localStorage.getItem(local_storage_sources_location) ?? JSON.stringify(sources);
		const url = URL.createObjectURL(new Blob([data], {type: "application/json"}));
		const link = document.createElement("a");
		link.href = url;
		link.download = "pwpal_sources.json";
		document.body.appendChild(link);
		link.click();
		link.remove();
		URL.revokeObjectURL(url);
		ShowStatus("Provider settings exported. Your master password is not included.");
	} catch {
		ShowStatus("Could not export providers. Check that browser storage and downloads are allowed.", true);
	}
}

new_entry_btn.addEventListener("click", () => OpenSource());
source_form.addEventListener("submit", SaveSource);
cancel_source_btn.addEventListener("click", () => new_entry_dialog.close());
delete_source_btn.addEventListener("click", () => DeleteSource(editing_source));
export_btn.addEventListener("click", ExportSources);
sources_filter_input.addEventListener("input", RenderSourcesList);
replace_from.addEventListener("input", ValidateReplacement);
replace_to.addEventListener("input", ValidateReplacement);
new_entry_dialog.addEventListener("close", () => {
	source_form.reset();
	editing_source = null;
});
toggle_password_btn.addEventListener("click", () => {
	const show = master_password_input.type === "password";
	master_password_input.type = show ? "text" : "password";
	toggle_password_btn.textContent = show ? "Hide" : "Show";
	toggle_password_btn.setAttribute("aria-pressed", String(show));
	toggle_password_btn.setAttribute("aria-label", show ? "Hide master password" : "Show master password");
});

window.addEventListener("beforeinstallprompt", event => {
	event.preventDefault();
	install_prompt = event;
	install_btn.hidden = false;
});
install_btn.addEventListener("click", async () => {
	if (!install_prompt) return;
	const prompt = install_prompt;
	install_prompt = null;
	install_btn.hidden = true;
	try {
		await prompt.prompt();
	} catch {
		ShowStatus("Use your browser menu to install PwPal.", true);
	}
});
window.addEventListener("appinstalled", () => {
	install_prompt = null;
	install_btn.hidden = true;
});

try {
	const saved = JSON.parse(localStorage.getItem(local_storage_sources_location) ?? "[]");
	if (!Array.isArray(saved) || !saved.every(IsValidSource)) throw new Error("Invalid providers");
	sources = saved;
	storage_loaded = true;
} catch {
	ShowStatus("Could not read saved providers. Existing data was left untouched; export a backup before making changes.", true);
}
RenderSourcesList();

if (!window.isSecureContext) {
	ShowStatus("Open PwPal over HTTPS or localhost to generate passwords and enable offline installation.", true);
} else if ("serviceWorker" in navigator) {
	navigator.serviceWorker.register("./sw.js")
		.then(() => navigator.serviceWorker.ready)
		.then(() => { offline_status.textContent = "Offline ready"; })
		.catch(() => ShowStatus("Offline setup failed. Reconnect and reload to try again.", true));
}
