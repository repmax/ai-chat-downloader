const genButton = document.querySelector('#generateBtn');
const markdownTextarea = document.getElementById('markdown');
const filenameInput = document.getElementById('filename');

let fullUrl, hostUrl;

genButton.addEventListener('click', async () => {
	const [tab] = await chrome.tabs.query({ active: true, windowId: (await chrome.windows.getCurrent()).id });
	if (!tab?.id) return;

	fullUrl = tab.url;
	const { host } = new URL(fullUrl);
	hostUrl = host.replace("www.", "");

	// Improved version
	const getBotInfo = (url) => {
		if (url.includes("claude.ai")) {
			const match = url.match(/\/chat\/([^/?]+)/);
			return { bot: "claude", networkID: match?.[1] };
		}
		if (url.includes("chatgpt.com")) {
			const match = url.match(/\/c\/([^/?]+)/);
			return { bot: "chatgpt", networkID: match?.[1] };
		}
		if (url.includes("you.com")) {
			return { bot: "you", networkID: "streamingSavedChat" };
		}
		if (url.includes("perplexity.ai")) {
			const match = url.match(/\/search\/([^/?]+)/);
			return { bot: "perplexity", networkID: match?.[1] };
		}
		return { bot: null, networkID: null };
	};

	const { bot, networkID } = getBotInfo(fullUrl);
	if (!bot) {
		console.log("Unrecognized page");
		document.querySelector('#message').classList.remove('hidden');
		return;
	}

	document.querySelector('.spinner').classList.remove('hidden');
	document.querySelector('#message').classList.add('hidden');

	const getRequestData = async (request) => {
		const contentTypeHeader = request.response.headers.find(header => header.name.toLowerCase() === 'content-type');
		if (!(contentTypeHeader && contentTypeHeader.value.includes('application/json'))) { return };
		const response = await new Promise((resolve) => request.getContent(resolve));
		return JSON.parse(response);
	}

	const donePreview = (listener) => {
		document.getElementById('downloadBtn').addEventListener('click', downFunction);
		document.querySelector('.spinner').classList.add('hidden');
		document.querySelector('.hideable').classList.remove('hidden');
		chrome.devtools.network.onRequestFinished.removeListener(listener);
	};

	const listener = async (request) => {
		if (!request.request.url.includes(networkID)) { return };
		if (bot === "you") {
			// Process you.com content here
			const content = await new Promise((resolve) => request.getContent(resolve));
			const chatEvent = content.split('\n\n').find(event => event.startsWith('event: youChatCachedChat'));

			if (!chatEvent) return;
			const dataString = chatEvent.split('\n')[1].substring(5);
			const data = JSON.parse(dataString);
			const titleRaw = data.chat[0].question;
			const { frontmatter, slug } = createFrontMatter(titleRaw);
			let youStandard = data.chat.flatMap(chat => [
				{
					author: 'human',
					text: chat.question
				},
				{
					author: 'bot',
					text: chat.answer.replace(/\[\[(\d+)\]\]/g, "[$1]"),
					botName: chat.ai_model || chat.chat_mode || '',
					sources: chat.serp_results?.map(serp => ({
						name: serp.name,
						url: serp.url
					})) || []
				}
			]);
			const markdown = createMarkdown(youStandard);
			markdownTextarea.value = frontmatter + "\n***\n" + markdown;
			filenameInput.value = slug + ".md";
			donePreview(listener);
		} else if (bot === "claude") {
			// CLAUDE
			const data = await getRequestData(request);
			// Process claude.ai content here
			const titleRaw = data.name;
			const created = data.created_at.slice(0, 10);
			const { frontmatter, slug } = createFrontMatter(titleRaw, created);

			let claudeStandard = data.chat_messages.map(chat => ({
				author: chat.sender === 'human' ? 'human' : 'bot',
				text: chat.text,
			}));
			const markdown = createMarkdown(claudeStandard);
			markdownTextarea.value = frontmatter + "\n***\n" + markdown;
			filenameInput.value = slug + ".md";
			donePreview(listener);
		} else if (bot === "chatgpt") {
			// CHATGPT
			const data = await getRequestData(request);
			const titleRaw = data.title;
			const unixTimestamp = data.create_time;
			const timestampInMs = unixTimestamp * 1000;
			const date = new Date(timestampInMs);
			const created = date.toISOString().slice(0, 10);
			const { frontmatter, slug } = createFrontMatter(titleRaw, created);
			let msg = [];
			let myobj = data.mapping
			let keys = Object.keys(myobj);
			msg.push(myobj[keys[0]]);
			while (msg.at(0).parent)
				msg.unshift(myobj[msg[0].parent]);
			while (msg.at(-1).children && msg.at(-1).children.length > 0)
				msg.push(myobj[msg.at(-1).children[0]]);
			msg = msg
				.map(item => item.message)
				.filter(item => (item && item.author && ['user', 'assistant'].includes(item.author.role)))
				.map(chat => ({
					author: chat.author.role === 'user' ? 'human' : 'bot',
					text: chat.content.parts[0],
					botName: chat.metadata?.model_slug || ''
				}));
			const markdown = createMarkdown(msg);
			markdownTextarea.value = frontmatter + "\n***\n" + markdown;
			filenameInput.value = slug + ".md";
			donePreview(listener);
		} else if (bot === "perplexity") {
			// PERPLEXITY
			//
			const content = await new Promise((resolve) => request.getContent(resolve));
			const pattern = /<script>([\s\S]*?)<\/script>/gi;
			const temp = [...content.matchAll(pattern)]
				.map(match => match[1].trim())
				.filter(event => event.startsWith('self.__next_f.push([1,\"[{\\\"step_type\\\": \\\"INITIAL_QUERY\\\",'))
				.map(line => (line.match(/".*"/s)[0] || null))
				.filter(string => string !== null)
			const entries = temp.map(string => JSON.parse(JSON.parse(string)));

			const titleRaw = entries[0][0].content.query;
			//const created = new Date(entries[0].updated_datetime).toISOString().slice(0, 10);
			const { frontmatter, slug } = createFrontMatter(titleRaw);

			let perplexStandard = entries.map(entry => {
				if (!Array.isArray(entry)) { return };
				let standardEntry = {
					author: 'bot',
					text: ''
				};
				let stepObj = Object.fromEntries(entry.map(item => [item.step_type, item]));
				const answerObj = JSON.parse(stepObj.FINAL?.content?.answer ?? '{}');
				standardEntry.text = answerObj.answer || '';
				if (stepObj.SEARCH_RESULTS) {
					standardEntry.sources = stepObj.SEARCH_RESULTS.content.web_results.map(val => ({
						name: val.name,
						url: val.url
					}));
				}
				if (stepObj.SEARCH_WEB) {
					standardEntry.related = stepObj.SEARCH_WEB.content.queries.map(val => ({
						name: val.name,
						url: `https://www.google.com/search?q=${encodeURI(val.url)}`
					}));
				}
				return [
					{ author: 'human', text: entry[0].content.query },
					standardEntry
				];
			}).flat();

			const markdown = createMarkdown(perplexStandard);
			markdownTextarea.value = frontmatter + "\n" + markdown;
			filenameInput.value = slug + ".md";
			donePreview(listener);
		}
	}
	chrome.devtools.network.onRequestFinished.addListener(listener);
	chrome.tabs.reload(tab.id);
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
	const stopwords = new Set(['i', 'write', 'you', 'me', 'the', 'is', 'are', 'for', 'in', 'this', 'who', 'what', 'when', 'how', 'why', 'should', 'can', 'did', 'do', 'tell', 'write', 'act', 'as', 'a', 'an']);
	const titleClean = titleRaw.replace(/[^a-zA-Z0-9 ]/g, "").replace(/\s+/g, ' ').substring(0, 70);
	const now = new Date();
	const dashedDate = now.toISOString().substring(0, 10);
	const shortDate = dashedDate.replace(/[^0-9]/g, "");
	const rinseTitle = titleClean.split(' ')
		.map(item => item.trim())
		.filter((word) => !stopwords.has(word.toLowerCase()))
		.reduce((shortened, word) =>
			shortened.length + word.length + 1 <= 50 ? shortened + word + ' ' : shortened, '')
		.trim();
	const condensedTitle = rinseTitle.toLowerCase().trim().replace(/ /g, "_");
	const slug = `prmt-${condensedTitle}-${created_at ? created_at.replace(/[^0-9]/g, "") : shortDate}`;
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

function createMarkdown(standardData) {
	return standardData.map(section => {
		let markdown = '';

		if (section.author === 'human') {
			markdown += `***\n\n**PROMPT** >>>>>>\n\n${section.text}\n`;
		} else {
			markdown += `\n**BOT**${section.botName ? ` > ${section.botName}` : ''} >>>>>>\n\n${section.text}\n`;
			if (section.sources && section.sources.length > 0) {
				markdown += '\n**SOURCES** >>>>>>\n\n' + section.sources.map((source, index) => `${index + 1}. [${source.name}](${source.url})`).join('\n') + '\n';
			}
			if (section.related && section.related.length > 0) {
				markdown += '\n**RELATED** >>>>>>\n\n' + section.related.map(query => `> [${query.name}](${query.url})`).join('\n\n') + '\n';
			}
		}

		return markdown;
	}).join('\n\n');
}

document.querySelector('.info-icon').addEventListener('click', function () {
	document.getElementById('infoModal').style.display = 'flex';
});

document.getElementById('closeModal').addEventListener('click', function () {
	document.getElementById('infoModal').style.display = 'none';
});

