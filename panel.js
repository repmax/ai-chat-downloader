// DOM elements
const viewButton = document.querySelector('#previewBtn');
const markdownTextarea = document.getElementById('markdown');
const filenameInput = document.getElementById('filename');

let fullUrl, hostUrl;

// Event listener for button click
viewButton.addEventListener('click', async () => {
	const tab = await getActiveTab();
	if (!tab) return;

	({ fullUrl, hostUrl } = await getUrlInfo(tab));

	const botInfo = getBotInfo(fullUrl);
	if (!botInfo) {
		showUnsupportedPageMessage();
		return;
	}

	showLoadingState();

	// Set up the listener
	const listener = async (request) => {
		// Filter requests
		if (!isRelevantRequest(request, botInfo)) return;
		// Remove the listener early so other requests do not pass while resolving promises (await)
		chrome.devtools.network.onRequestFinished.removeListener(listener);
		const response = await new Promise((resolve) => request.getContent(resolve));
		const processor = processors[botInfo.bot];
		const chatData = await processor(response);
		updateUI(chatData);
	};

	chrome.devtools.network.onRequestFinished.addListener(listener);
	chrome.tabs.reload(tab.id);
});

async function getActiveTab() {
	const [tab] = await chrome.tabs.query({ active: true, windowId: (await chrome.windows.getCurrent()).id });
	return tab?.id ? tab : null;
}

async function getUrlInfo(tab) {
	const fullUrl = tab.url;
	const { host } = new URL(fullUrl);
	const hostUrl = host.replace("www.", "");
	return { fullUrl, hostUrl };
}

function getBotInfo(url) {
	const botPatterns = {
		'claude.ai': { bot: 'claude', pattern: /\/chat\/([^/?]+)/, contentType: 'application/json' },
		'chatgpt.com': { bot: 'chatgpt', pattern: /\/c\/([^/?]+)/, contentType: 'application/json' },
		'you.com': { bot: 'you', networkID: 'streamingSavedChat' },
		'perplexity.ai': { bot: 'perplexity', pattern: /\/search\/([^/?]+)/ }
	};

	for (const [domain, info] of Object.entries(botPatterns)) {
		if (url.includes(domain)) {
			const match = info.pattern ? url.match(info.pattern) : null;
			return { ...info, networkID: match?.[1] ?? info.networkID };
		}
	}
	return null;
}

function showUnsupportedPageMessage() {
	console.log("Unrecognized page");
	document.querySelector('#message').classList.remove('hidden');
}

function showLoadingState() {
	document.querySelector('.spinner').classList.remove('hidden');
	document.querySelector('#message').classList.add('hidden');
	document.querySelector('.hideable').classList.add('hidden');
}

function createNetworkListener({ bot, networkID, contentType }) {
	return async (request) => {
		if (!isRelevantRequest(request, networkID, contentType)) return;

		chrome.devtools.network.onRequestFinished.removeListener(listener);
		const response = await getRequestContent(request);

		const botHandler = botHandlers[bot];
		if (!botHandler) return;

		const dialogueData = await botHandler(response);
		updateUI(dialogueData);
	};
}

function isRelevantRequest(request, { networkID, contentType = null }) {
	if (!request.request.url.includes(networkID)) return false;
	if (contentType) {
		const contentTypeHeader = request.response.headers.find(header => header.name.toLowerCase() === 'content-type');
		return contentTypeHeader?.value.includes(contentType);
	}
	return true;
}

async function getRequestContent(request) {
	return new Promise((resolve) => request.getContent(resolve));
}

const processors = {
	you: async (response) => {
		const chatEvent = response.split('\n\n').find(event => event.startsWith('event: youChatCachedChat'));
		if (!chatEvent) return;
		const dataString = chatEvent.split('\n')[1].substring(5);
		const data = JSON.parse(dataString);
		title = data.chat[0].question;
		dialogue = data.chat.flatMap(chat => [
			{ author: 'human', text: chat.question },
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
		return {title,dialogue};
	},
	claude: async (response) => {
		const data = JSON.parse(response);
		const title = data.name;
		const created = data.created_at.slice(0, 10);
		const dialogue = data.chat_messages.map(chat => ({
			author: chat.sender === 'human' ? 'human' : 'bot',
			text: chat.text,
		}));
		return {title,dialogue,created};
	},
	chatgpt: async (response) => {
		const data = JSON.parse(response);
		const title = data.title;
		const createdUnix = data.create_time * 1000;
		const created = new Date(createdUnix).toISOString().slice(0, 10);
		let messages = [];
		let mapping = data.mapping;
		let keys = Object.keys(mapping);
		messages.push(mapping[keys[0]]);
		while (messages.at(0).parent)
			messages.unshift(mapping[messages[0].parent]);
		while (messages.at(-1).children && messages.at(-1).children.length > 0)
			messages.push(mapping[messages.at(-1).children[0]]);
		const dialogue = messages
			.map(item => item.message)
			.filter(item => item && item.author && ['user', 'assistant'].includes(item.author.role))
			.map(chat => ({
				author: chat.author.role === 'user' ? 'human' : 'bot',
				text: chat.content.parts[0],
				botName: chat.metadata?.model_slug || ''
			}));
		return {title,dialogue,created};
	},
	perplexity: async (response) => {
		const pattern = /<script>([\s\S]*?)<\/script>/gi;
		const matchedScripts = [...response.matchAll(pattern)];

		const scriptContents = matchedScripts
			.map(match => match[1].trim())
			.filter(script => script.startsWith('self.__next_f.push([1,"[{\\\"step_type\\\": \\\"INITIAL_QUERY\\\",'))
			.map(script => (script.match(/".*"/s)[0] || null))
			.filter(string => string !== null);

		const entries = scriptContents.map(string => JSON.parse(JSON.parse(string)));
		const title = entries[0][0].content.query;

		const dialogue = entries.map(entry => {
			if (!Array.isArray(entry)) return;
			const standardEntry = {
				author: 'bot',
				text: ''
			};

			const stepObj = Object.fromEntries(entry.map(item => [item.step_type, item]));
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
		return {title,dialogue};
	}
};

function updateUI({ title, created=null, dialogue }) {
	const { frontmatter, slug } = createFrontMatter(title, created);
	const markdown = createMarkdown(dialogue);
	markdownTextarea.value = `${frontmatter}\n${markdown}`;
	filenameInput.value = `${slug}.md`;
	document.getElementById('downloadBtn').addEventListener('click', handleDownload);
	document.querySelector('.spinner').classList.add('hidden');
	document.querySelector('.hideable').classList.remove('hidden');
}

function handleDownload() {
	this.classList.add('inactive');
	this.disabled = true;

	setTimeout(() => {
		this.classList.remove('inactive');
		this.disabled = false;
	}, 4000);

	downloadMarkdownFile(markdownTextarea.value, filenameInput.value);
}

function downloadMarkdownFile(content, filename) {
	const blob = new Blob([content], { type: 'text/markdown' });
	const url = URL.createObjectURL(blob);
	const a = document.createElement('a');
	a.href = url;
	a.download = filename;
	document.body.appendChild(a);
	a.click();
	document.body.removeChild(a);
	URL.revokeObjectURL(url);
}

// Function to create front matter for markdown files
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

// Function to generate markdown content
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
	}).join('\n');
}

// Modal functionality
document.querySelector('.info-icon').addEventListener('click', () => {
	document.getElementById('infoModal').style.display = 'flex';
});

document.getElementById('closeModal').addEventListener('click', () => {
	document.getElementById('infoModal').style.display = 'none';
});