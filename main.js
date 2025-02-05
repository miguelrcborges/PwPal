const master_input = document.querySelector("#master-sequence");
const new_element_input = document.querySelector("#new-element-input");
const sources_container = document.querySelector("#saved-elements");
const encoder = new TextEncoder();


function CreateSourceElement(s) {
	const container = document.createElement('div');
	const span = document.createElement('span');
	span.textContent = s;
	container.appendChild(span);
	const passwordCap = document.createElement('input')
	passwordCap.setAttribute('type', 'number');
	passwordCap.value = "16";
	container.appendChild(passwordCap);
	const deleteButton = document.createElement('button');
	deleteButton.textContent = "Delete"
	deleteButton.addEventListener('click', DeleteElement);
	container.appendChild(deleteButton);
	const copyButton = document.createElement('button');
	copyButton.textContent = "Copy Password"
	copyButton.addEventListener('click', CopyPassword);
	container.appendChild(copyButton);
	return container;
}


function DeleteElement(e) {
	e.target.parentElement.remove();
}

async function CopyPassword(e) {
	const source = e.target.parentElement.firstChild.textContent;
	const salted_pw = master_input.value + source;
	const hash = await HashInput(salted_pw);
	const pw_len_cap = e.target.parentElement.children[1].value - 0;
	// you need 44.8 base64 into 2^512, considering 22 as center
	const start = 22 - (pw_len_cap >> 1);
	const final_pw = hash.slice(start, start + pw_len_cap);
	await navigator.clipboard.writeText(final_pw);
}


async function HashInput(input) {
	const data = encoder.encode(input);
	const hash = await window.crypto.subtle.digest("SHA-256", data);
	const hash_viewer = new Uint8Array(hash);
	const bytes_str = hash_viewer.reduce((acc, c) => acc + String.fromCharCode(c));
	const password = window.btoa(bytes_str);
	return password;
}


document.querySelector("#new-element-button").addEventListener('click', () => {
	sources_container.appendChild(CreateSourceElement(new_element_input.value));
	new_element_input.value = "";
});
