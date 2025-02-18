const master_password = document.querySelector("#master-password");
const sources_container = document.querySelector("#sources-container");
const safe_text_element = document.createElement('div');
const encoder = new TextEncoder();
const local_storage_sources_location = "pwpal-sources";

const sources = JSON.parse(localStorage.getItem(local_storage_sources_location)) ?? [];

function EscapeString(s) {
	safe_text_element.textContent = s;
	return safe_text_element.innerHTML;
}

function RenderSourcesList() {
	const sources_html = sources.map((p, i) => 
		`<div class="password-source">
			<span>${EscapeString(p[0])}</span>
			<input type="number" value="${p[1]}" name="password-length" onchange="SetSourcePasswordLen(${i}, parseInt(this.value))">
			<button onclick="DeleteSource(${i})" class="delete">Delete</button>
			<button onclick="CopyPassword(${i})" class="primary">Copy</button>
		</div>`
	).join('');
	const add_source = 
		`<div class="password-source">
			<input id="new-element-input" type="text" placeholder="New source">
			<button onclick="AddSourceEvent()">+</button>
		</div>`;
	sources_container.innerHTML = sources_html + add_source;
}


function DeleteSource(i) {
	sources.splice(i, 1);
	localStorage.setItem(local_storage_sources_location, JSON.stringify(sources));
	RenderSourcesList();
}

async function CopyPassword(i) {
	const source = sources[i][0];
	const pw_len = sources[i][1];
	const salted_pw = master_password.value + source;
	const hash = await HashInput(salted_pw);
	// you need 44.8 base64 into 2^512, considering 22 as center
	const start = 22 - (pw_len >> 1);
	const final_pw = hash.slice(start, start + pw_len);
	await navigator.clipboard.writeText(final_pw);
}

function AddSourceEvent(e) {
	sources.push([document.querySelector("#new-element-input").value, 16]);
	localStorage.setItem(local_storage_sources_location, JSON.stringify(sources));
	RenderSourcesList();
}

function SetSourcePasswordLen(s_i, l) {
	sources[s_i][1] = l;
	localStorage.setItem(local_storage_sources_location, JSON.stringify(sources));
}

async function HashInput(input) {
	const data = encoder.encode(input);
	const hash = await window.crypto.subtle.digest("SHA-256", data);
	const hash_viewer = new Uint8Array(hash);
	const bytes_str = hash_viewer.reduce((acc, c) => acc + String.fromCharCode(c));
	const password = window.btoa(bytes_str);
	return password;
}

RenderSourcesList();
