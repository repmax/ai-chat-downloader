const genButton = document.querySelector('#generateBtn');
const markdownTextarea = document.getElementById('markdown');
const filenameInput = document.getElementById('filename');

let fullUrl, hostUrl;

genButton.addEventListener('click', async () => {
	document.querySelector('.spinner').classList.remove('hidden');
	const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
	const activeTabId = tabs?.[0]?.id;
	if (!activeTabId) return;
	fullUrl = tabs[0].url;
	const url_object = new URL(fullUrl);
	hostUrl = url_object.host.replace("www.", "");

	chrome.devtools.network.onRequestFinished.addListener(async (request) => {
		if (!request.request.url.startsWith('https://you.com/api/streamingSavedChat')) return;

		const content = await new Promise((resolve) => request.getContent(resolve));
		const chatEvent = content.split('\n\n').find(event => event.startsWith('event: youChatCachedChat'));
		if (!chatEvent) return;

		try {
			const dataString = chatEvent.split('\n')[1].substring(5);

			const data = JSON.parse(dataString);
			const titleRaw = data.chat[0].question;
			const { frontmatter, slug } = createFrontMatter(titleRaw);
			const markdown = createMarkdown(data, frontmatter);
			markdownTextarea.value = markdown;
			filenameInput.value = slug + ".md";

			// prepare download button ready
			document.getElementById('downloadBtn').addEventListener('click', function () {
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
			});

			document.querySelector('.spinner').classList.add('hidden');
			document.querySelector('.hideable').classList.remove('hidden');

		} catch (error) {
			console.error('Error processing chat data:', error);
		}
	});
	chrome.tabs.reload(activeTabId);
});

function createFrontMatter(titleRaw) {
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
	const slug = `prmt-${condensedTitle}-${shortDate}`;


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
created: 
---

# ${rinseTitle}

Link: [${hostUrl}](${fullUrl})

`;

	return { frontmatter, slug };
}

function createMarkdown(data, frontmatter) {
	return frontmatter + "\n***\n" + data.chat.map(chat => {
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

