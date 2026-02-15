const encoder = new TextEncoder();
const local_storage_sources_location = "pwpal-sources";
const sources = JSON.parse(localStorage.getItem(local_storage_sources_location)) ?? [];
const safe_text_element = document.createElement('div');

function EscapeString(s) {
	safe_text_element.textContent = s;
	return safe_text_element.innerHTML;
}

function RenderSourcesList() {
	const filter = sources_filter_input.value.toUpperCase();
	const sources_html = sources
		.filter(s => s[0].toUpperCase().includes(filter))
		.map((p, i) =>
			`<div class="password-source">
				<h5>${EscapeString(p[0])}</h5>
				<div class="inline-buttons">
					<button onclick="DeleteSource(${i})" class="secondary-btn">Delete</button>
					<button onclick="CopyPassword(${i})" class="primary-btn">Copy</button>
				</div>
			</div>`
		).join('');
	sources_container.innerHTML = sources_html;
}


function DeleteSource(i) {
	sources.splice(i, 1);
	localStorage.setItem(local_storage_sources_location, JSON.stringify(sources));
	RenderSourcesList();
}

async function CopyPassword(i) {
	const source = sources[i][0];
	const pw_len = sources[i][1];
	const salted_pw = master_password_input.value + source;
	const hash = await HashInput(salted_pw);
	// you need 44.8 base64 into 2^512, considering 22 as center
	const start = 22 - (pw_len >> 1);
	const final_pw = hash.slice(start, start + pw_len);
	await navigator.clipboard.writeText(final_pw);
}

function AddSource() {
	sources.push([service_name.value, Number(password_length.value)]);
	sources.sort((s1, s2) => s1[0].toUpperCase() < s2[0].toUpperCase() ? -1 : 1);
	localStorage.setItem(local_storage_sources_location, JSON.stringify(sources));
	RenderSourcesList();
}

async function HashInput(input) {
	const data = encoder.encode(input);
	const hash = await window.crypto.subtle.digest("SHA-256", data);
	const hash_viewer = new Uint8Array(hash);
	const bytes_str = hash_viewer.reduce((acc, c) => acc + String.fromCharCode(c));
	const password = window.btoa(bytes_str);
	return password;
}

async function ExportSources() {
	const data = JSON.stringify(sources);
	const blob = new Blob([data], {type: "application/json"});
	const url = URL.createObjectURL(blob);
	
	const dummy = document.createElement('a');
	dummy.href = url;
	dummy.download = "pwpal_sources.json";

	document.body.appendChild(dummy);
	dummy.click();
	document.body.removeChild(dummy);
	URL.revokeObjectURL(url);
}

new_entry_btn.addEventListener('click', () => new_entry_dialog.showModal());
export_btn.addEventListener('click', ExportSources);
sources_filter_input.addEventListener('input', RenderSourcesList);
new_entry_dialog.addEventListener('close', (e) => {
	if (new_entry_dialog.returnValue == "add") {
		AddSource();
	}
	service_name.value = "";
	password_length.value = 16;
});

RenderSourcesList();
