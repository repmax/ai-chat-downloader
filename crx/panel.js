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
		console.log("isRelevantRequest", request);
		// Remove the listener early so other requests do not pass while resolving promises (await)
		chrome.devtools.network.onRequestFinished.removeListener(listener);
		const response = await new Promise((resolve) => request.getContent(resolve));
		const processor = processors[botInfo.bot];
		const chatData = await processor(response);
		updateUI(chatData);
	};
	console.log("addListener");
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
		'you.com': { bot: 'you', networkID: 'streamingSavedChat', protocol:"GET" },
		'x.com': { bot: 'grok', networkID: 'GrokConversation', protocol:"GET" },
		'google.com': { bot: 'google', networkID: 'GetPrompt', contentType: 'application/json', protocol:"POST" },
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

function isRelevantRequest(request, { networkID, contentType = null, protocol = null }) {
	if (!request.request.url.includes(networkID)) return false;
	if (protocol) {
		if (request.request.method !== protocol) return false;
	}
	if (contentType) {
		const contentTypeHeader = request.response.headers.find(header => header.name.toLowerCase() === 'content-type');
		return contentTypeHeader?.value.includes(contentType);
	}
	return true;
}

const processors = {
	grok: async (response) => {
		let {data} = JSON.parse(response);
		const chat_list = data[Object.keys(data)[0]]['items'].reverse();
		const title = chat_list[0].message;
		const created = new Date(chat_list[0].created_at_ms).toISOString().slice(0, 10);
		const dialogue = chat_list.map(chat => ({
			author: chat.sender_type === 'User' ? 'prompt' : 'bot',
			text: chat.message,
			sources: chat.web_results?.map(serp => ({
				name: serp.title,
				url: serp.url
			})) || []
		}));

		return {title,dialogue,created};
	},
	you: async (response) => {
		const chatEvent = response.split('\n\n').find(event => event.startsWith('event: youChatCachedChat'));
		if (!chatEvent) return;
		const dataString = chatEvent.split('\n')[1].substring(5);
		const data = JSON.parse(dataString);
		title = data.chat[0].question;
		dialogue = data.chat
			.filter(chat => chat.question && chat.answer)
			.flatMap(chat => [
				{ author: 'prompt', text: chat.question },
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
			author: chat.sender === 'human' ? 'prompt' : 'bot',
			text: chat.content[0].text,
		}));
		return {title,dialogue,created};
	},
	google: async (response) => {
		const data = JSON.parse(response);
		const title = data[4][0].trim();
		const dialogue = data.at(-1)[0].map(chat => ({
			author: chat.some(item => item === 'user') ? 'prompt' : 'bot',
			text: chat[0],
		}));
		return {title,dialogue};
	},
	chatgpt: async (response) => {
		const data = JSON.parse(response);
		const title = data.title;
		const createdUnix = data.create_time * 1000;
		const created = new Date(createdUnix).toISOString().slice(0, 10);
		let messages = [];
		let mapping = data.mapping;
		let keys = Object.keys(mapping);
		messages.push(mapping[keys.at(-1)]); // start from last because messages are sorted by timestamp.
		while (messages.at(0).parent)
			messages.unshift(mapping[messages[0].parent]);
		while (messages.at(-1).children && messages.at(-1).children.length > 0)
			messages.push(mapping[messages.at(-1).children[0]]);
		const dialogue = messages
			.map(item => item.message)
			.filter(item => item && item.content.content_type && item.content.content_type === "text" && item.author && ['user', 'assistant'].includes(item.author.role))
			.map(chat => ({
				author: chat.author.role === 'user' ? 'prompt' : 'bot',
				text: chat.content.parts[0],
				botName: chat.metadata?.model_slug || ''
			}));
		return {title,dialogue,created};
	},
	perplexity: async (response) => {
		const pattern = /<script\b[^>]*>([\s\S]*?)<\/script>/gi;
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
					name: val.query,
					url: `https://www.google.com/search?q=${encodeURI(val.query)}`
				}));
			}

			return [
				{ author: 'prompt', text: entry[0].content.query },
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
		if (section.author === 'prompt') {
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