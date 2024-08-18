const genButton = document.querySelector('#generateBtn');
const markdownTextarea = document.getElementById('markdown');
const filenameInput = document.getElementById('filename');

let fullUrl, hostUrl;

genButton.addEventListener('click', async () => {
	const tabs = await chrome.tabs.query({ active: true, windowId: (await chrome.windows.getCurrent()).id });
	const activeTabId = tabs?.[0]?.id;
	if (!activeTabId) return;
	fullUrl = tabs[0].url;
	const url_object = new URL(fullUrl);
	hostUrl = url_object.host.replace("www.", "");

	let bot, networkID;
	if (fullUrl.includes("claude.ai")) {
		bot = "claude";
		const match = fullUrl.match(/\/chat\/([^/?]+)/);
		networkID = match[1];
	} else if (fullUrl.includes("you.com")) {
		bot = "you";
		networkID = "streamingSavedChat";
	} else {
		console.log("Unrecognized page");
		document.querySelector('#message').classList.remove('hidden');
		return;
	}
	document.querySelector('.spinner').classList.remove('hidden');
	document.querySelector('#message').classList.add('hidden');

	const listener = async (request) => {
		if (bot === "you" && request.request.url.includes(networkID)) {
			// Process you.com content here
			const content = await new Promise((resolve) => request.getContent(resolve));
			const chatEvent = content.split('\n\n').find(event => event.startsWith('event: youChatCachedChat'));
			if (!chatEvent) return;

			try {
				const dataString = chatEvent.split('\n')[1].substring(5);

				const data = JSON.parse(dataString);
				const titleRaw = data.chat[0].question;
				const { frontmatter, slug } = createFrontMatter(titleRaw);
				const markdown = createMarkdownYou(data);
				markdownTextarea.value = frontmatter + "\n***\n" + markdown;
				filenameInput.value = slug + ".md";

				// prepare download button ready
				document.getElementById('downloadBtn').addEventListener('click', downFunction);

				document.querySelector('.spinner').classList.add('hidden');
				document.querySelector('.hideable').classList.remove('hidden');
				chrome.devtools.network.onRequestFinished.removeListener(listener);
			} catch (error) {
				console.error('Error processing chat data:', error);
			}
		} else if (bot === "claude" && request.request.url.includes(networkID)) {
			const contentTypeHeader = request.response.headers.find(header => header.name.toLowerCase() === 'content-type');
			if (!(contentTypeHeader && contentTypeHeader.value.includes('application/json'))){return};

			const response = await new Promise((resolve) => request.getContent(resolve));
			const data = JSON.parse(response);
			// Process claude.ai content here
			const titleRaw = data.name;
			const created = data.created_at.slice(0, 10);
			const { frontmatter, slug } = createFrontMatter(titleRaw, created);

			const markdown = createMarkdownClaude(data.chat_messages);
			markdownTextarea.value = frontmatter + "\n***\n" + markdown;
			filenameInput.value = slug + ".md";

			// prepare download button ready
			document.getElementById('downloadBtn').addEventListener('click', downFunction);
			document.querySelector('.spinner').classList.add('hidden');
			document.querySelector('.hideable').classList.remove('hidden');
			chrome.devtools.network.onRequestFinished.removeListener(listener);
		}
	}
	chrome.devtools.network.onRequestFinished.addListener(listener);
	chrome.tabs.reload(activeTabId);
});

function downFunction() {
	this.classList.add('inactive');
	this.disabled = true;

	setTimeout(() => {
		this.classList.remove('inactive');
		this.disabled = false;
	}, 4000);

	const markdownContent = markdownTextarea.value;
	const filename = filenameInput.value;

	const blob = new Blob([markdownContent], { type: 'text/markdown' });
	const url = URL.createObjectURL(blob);

	const a = document.createElement('a');
	a.href = url;
	a.download = filename;
	document.body.appendChild(a);
	a.click();

	document.body.removeChild(a);
	URL.revokeObjectURL(url);
}

function createFrontMatter(titleRaw, created_at = '') {
	const stopwords = ['i', 'write', 'you', 'me', 'the', 'is', 'are', 'for', 'in', 'this', 'who', 'what', 'when', 'how', 'why', 'should', 'can', 'did', 'do', 'tell', 'write', 'act', 'as', 'a', 'an'];
	const titleClean = titleRaw.replace(/[^a-zA-Z0-9 ]/g, "").replace(/\s+/g, ' ').substring(0, 70);
	const now = new Date();
	const dashedDate = now.toISOString().substring(0, 10);
	const shortDate = dashedDate.replace(/[^0-9]/g, "");
	const rinseTitle = titleClean.split(' ')
		.map(item => item.trim())
		.filter((item) => !stopwords.includes(item.toLowerCase()))
		.reduce((shortened, word) =>
			shortened.length + word.length + 1 <= 50 ? shortened + word + ' ' : shortened, '')
		.trim();
	const condensedTitle = rinseTitle.toLowerCase().trim().replace(/ /g, "_");
	const slug = `prmt-${condensedTitle}-${created_at? created_at.replace(/[^0-9]/g,"") : shortDate}`;
	const frontmatter = `---
title: "${rinseTitle}"
author: 
tags: []
pagetitle: "${titleClean}"
bot: "${hostUrl}"
type: aichat
source: ${fullUrl}
slug: ${slug}
saved: ${dashedDate}
created: ${created_at}
---

# ${rinseTitle}

Link: [${hostUrl}](${fullUrl})

`;

	return { frontmatter, slug };
}
function createMarkdownClaude(chat_messages) {
	return chat_messages.map(chat => {
		if (chat.sender === 'human') {
			return `
**PROMPT** >>>>>>

${chat.text}

`
		} else {
			let text = chat.text.replace(/<antArtifact[^>]*>/, '```').replace(/<\/antArtifact>/, '```');
			return `**BOT** >>>>>>

${text}

\n***\n
`;
		}
	}).join("");
}

function createMarkdownYou(data) {
	return data.chat.map(chat => {
		// yousearch uses [[number]] as reference link. 
		let item = `
**PROMPT** >>>>>>

${chat.question}

**BOT** > ${chat.ai_model || chat.chat_mode} >>>>>>

${chat.answer.replace(/\[\[(\d+)\]\]/g, "[$1]")}
`;
		if (chat.serp_results && chat.serp_results.length > 0) {
			item += `
SOURCES:
${chat.serp_results.map((serp => `- [${serp.name}](${serp.url})`)).join("\n")}
`;
		}
		return item;
	}).join("\n***\n");
}

document.querySelector('.info-icon').addEventListener('click', function () {
	document.getElementById('infoModal').style.display = 'flex';
});

document.getElementById('closeModal').addEventListener('click', function () {
	document.getElementById('infoModal').style.display = 'none';
});

