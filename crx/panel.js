// DOM elements
const profileInput = document.getElementById('profileInput');
chrome.storage.local.get(['profileName'], (result) => {
	if (result.profileName && profileInput) {
		profileInput.value = result.profileName;
	}
});

profileInput.addEventListener('input', () => {
	chrome.storage.local.set({ profileName: profileInput.value });
});

const previewButton = document.querySelector('#previewBtn');
const markdownTextarea = document.getElementById('markdown');
const filenameInput = document.getElementById('filename');

let fullUrl, hostUrl;
let showFullTree = true;

function listenWebpageExtract(message, sender, sendResponse) {
	if (message.type === "chat") {
		chrome.runtime.onMessage.removeListener(listenWebpageExtract);
		updateUI(message.result);
	}
}
document.addEventListener('DOMContentLoaded', () => {
	const showFullTreeCheckbox = document.getElementById('showFullTree');
	if (showFullTreeCheckbox) {
		showFullTreeCheckbox.checked = showFullTree;
		showFullTreeCheckbox.addEventListener('change', (e) => {
			showFullTree = e.target.checked;
		});
	}
});

function claude2Tree(rawMap) {
	// Create a map to hold the items. Initialize with a root item. Claude include parent ids but but not root item. 
	let itemMap = {
		"00000000-0000-4000-8000-000000000000": {
			type: 'irrelevant',
			parent: null,
			create_time: new Date(0).getTime() / 1000,
			children: []
		}
	};
	rawMap.forEach(item => {
		if (item.sender === 'human') {
			itemMap[item.uuid] = {
				type: 'PROMPT',
				parent: item.parent_message_uuid || null,
				create_time: new Date(item.created_at).getTime() / 1000, // Convert to timestamp
				text: item.content
					.filter(content => content.type === "text")
					.map(content => content.text)
					.join('\n\n'),
				children: []
			};
		} else if (item.sender === 'assistant') {
			const textContent = item.content
				.filter(content => content.type === "text")
				.map(content => content.text)
				.join('\n\n');
			const rawSources = item.content
				.filter(content => content.name === 'web_search' && content.type === 'tool_result')
				.flatMap(content => {
					if (Array.isArray(content.content)) {
						return content.content.map(serp => ({
							name: serp.title || '',
							url: serp.url || ''
						}));
					}
					return [];
				});

			itemMap[item.uuid] = {
				type: 'BOT',
				parent: item.parent_message_uuid || null,
				create_time: new Date(item.created_at).getTime() / 1000, // Convert to timestamp
				text: textContent,
				botName: 'claude',
				sources: rawSources, // Add sources to the item
				children: []
			};
		} else {
			itemMap[item.uuid] = {
				type: 'irrelevant',
				parent: item.parent_message_uuid || null,
				create_time: new Date(item.created_at).getTime() / 1000,
				children: []
			};
		}
	});
	let rootItem;
	Object.values(itemMap).forEach(item => {
		if (item.parent && itemMap[item.parent]) {
			itemMap[item.parent].children.push(item);
		} else {
			rootItem = item;
		}
	});

	Object.values(itemMap).forEach(item => {
		item.children.sort((a, b) => b.create_time - a.create_time);
	});

	return tree2Dialogue(rootItem);
}


function chatgpt2Tree(rawMap) {
	let itemMap = {};
	Object.keys(rawMap).forEach(key => {
		const item = rawMap[key];
		if (item.message && item.message.author && item.message.author.role) {
			if (item.message.author.role === 'user' && item.message.content && item.message.content.parts) {
				itemMap[key] = {
					type: 'PROMPT',
					parent: item.parent || null,
					create_time: item.message.create_time,
					text: item.message.content.parts[0],
					children: []
				};
			} else if (item.message.author.role === 'assistant' && item.message.content && item.message.content.parts) {
				itemMap[key] = {
					type: 'BOT',
					parent: item.parent || null,
					create_time: item.message.create_time,
					text: item.message.content.parts[0],
					botName: item.metadata?.model_slug || '',
					children: []
				};
			} else {
				itemMap[key] = {
					type: 'irrelevant',
					parent: item.parent || null,
					create_time: item.message.create_time,
					children: []
				};
			}
		}
	});

	let rootItem;
	Object.values(itemMap).forEach(item => {
		if (item.parent && itemMap[item.parent]) {
			itemMap[item.parent].children.push(item);
		} else {
			rootItem = item;
		}
	});
	Object.values(itemMap).forEach(item => {
		item.children.sort((a, b) => b.create_time - a.create_time);
	});

	return tree2Dialogue(rootItem);
}

function tree2Dialogue(rootNode) {
	const dialogue = [];
	function processNode(node, indentLevel) {
		function addOrIncrement(inlevel) {
			let level = [...inlevel];
			const last = level[level.length - 1];
			if (last && last.char === "-") {
				last.num++;
			} else {
				level.push({ char: "-", num: 1 });
			}
			return level
		}
		function sequence2string() {
			return indentLevel.map(entry =>
				entry.char === "-"
					? `|${entry.num}|`
					: `^${entry.num}`
			).join('');
		}
		const isUser = node.type === 'PROMPT';
		if (isUser && node.text) {
			dialogue.push({
				...node,
				turnId: sequence2string()
			})
		}
		const isAssistant = node.type === 'BOT';
		if (isAssistant && node.text) {
			dialogue.push({ ...node })
		}
		if (node.children && node.children.length > 0) {
			if (node.children.length === 1) {
				const childIndentLevel = node.children[0].type === 'PROMPT' ? addOrIncrement(indentLevel) : [...indentLevel];
				processNode(node.children[0], childIndentLevel);
			} else if (!showFullTree && node.children[0].type === 'PROMPT') {
				let lastChild = node.children[0];
				const childIndentLevel = [...indentLevel, { char: '<', num: node.children.length }];
				processNode(lastChild, childIndentLevel);
			} else {
				// If the current node is a user node and not something else, the indentlevel should increase with another digit. The digit then increase with 1 for each child node.
				node.children.forEach((child, index, array) => {
					const childIndentLevel = child.type === 'PROMPT' ? [...indentLevel, { char: '<', num: array.length - index }] : indentLevel;
					processNode(child, childIndentLevel);
				});

			}
		}
	}
	processNode(rootNode, []);
	return dialogue;
}

function extractWebpageIndexedDB(chat_id) {
	// This function runs in the context of the webpage
	const request = window.indexedDB.open("deepseek-chat");
	request.onsuccess = (event) => {
		const db = event.target.result;
		const transaction = db.transaction("history-message", "readonly");
		const store = transaction.objectStore("history-message");
		const getAllRequest = store.getAll();
		getAllRequest.onsuccess = () => {
			const result = getAllRequest.result.find(item => item.key === chat_id);
			const title = result.data.chat_session.title;
			const createdUnix = result.data.chat_session.updated_at * 1000;
			const created = new Date(createdUnix).toISOString().slice(0, 10);
			let tree = result.data.chat_messages
			let path = [tree.pop()];
			// only show the last conversation thread
			while (tree.length) {
				let currentTree = tree.at(-1);
				if (!currentTree.parent_id) {
					path.unshift(tree.pop());
					break;
				}
				if (path[0].parent_id === currentTree.message_id) {
					path.unshift(tree.pop());
				} else {
					tree.pop();
				}
			}
			const dialogue = path
				.map(message => ({
					type: message.type === 'USER' ? 'PROMPT' : 'BOT',
					text: message.thinking_content ? "(NOTES)\n" + message.thinking_content + "\n(/NOTES)\n\n" + message.content : message.content,
					botName: ''
				}));
			chrome.runtime.sendMessage({ type: "chat", result: { title, dialogue, created } });
		};
	};
}

// Event listener for button click
previewButton.addEventListener('click', async () => {
	const currentWindow = await chrome.windows.getCurrent();
	const [tab] = await chrome.tabs.query({ active: true, windowId: currentWindow.id });
	if (!tab) return;
	fullUrl = tab.url;
	hostUrl = new URL(fullUrl).host.replace("www.", "");

	if (fullUrl.includes("chat.deepseek.com")) {
		// Deepseek is not sending full chat via network request on every reload, 
		// but full chat is always stored in webpage indexedDB after a reload.
		showLoadingState();
		const chat_id = tab.url.split("/").pop().split("?")[0];
		chrome.devtools.inspectedWindow.reload({ ignoreCache: true });
		chrome.tabs.onUpdated.addListener(function listener(tabId, changeInfo) {
			if (tabId === tab.id && changeInfo.status === "complete") {
				chrome.tabs.onUpdated.removeListener(listener);
				chrome.scripting.executeScript({
					target: { tabId: tab.id },
					function: extractWebpageIndexedDB,
					args: [chat_id]
				});
			}
		});
		chrome.runtime.onMessage.addListener(listenWebpageExtract);
		return;
	}

	const botInfo = getBotInfo(fullUrl);
	if (!botInfo) {
		showUnsupportedPageMessage();
		return;
	}

	showLoadingState();
	let isProcessing = false;
	const listener = async (request) => {
		// Filter requests
		if (isProcessing || !isRelevantRequest(request, botInfo)) return;
		isProcessing = true;		// Remove the listener early so other requests do not pass while resolving promises (await)
		chrome.devtools.network.onRequestFinished.removeListener(listener);
		const response = await new Promise((resolve) => request.getContent(resolve));
		const processor = processors[botInfo.bot];
		const chatData = await processor(response);
		updateUI(chatData);
		isProcessing = false;
	};
	chrome.devtools.network.onRequestFinished.addListener(listener);
	chrome.devtools.inspectedWindow.reload({ ignoreCache: true });
});

function getBotInfo(url) {
	const botPatterns = {
		'claude.ai': { bot: 'claude', pattern: /\/chat\/([^/?]+)/, contentType: 'application/json' },
		'chatgpt.com': { bot: 'chatgpt', pattern: /\/c\/([^/?]+)/, contentType: 'application/json' },
		'minimax.io': { bot: 'minimax', pattern: /chatID=([^/?]+)/, contentType: 'application/json' },
		'you.com': { bot: 'you', networkID: 'streamingSavedChat', protocol: "GET" },
		'kimi.com': { bot: 'kimi', networkID: 'scroll', protocol: "POST" },
		'x.com': { bot: 'grok', networkID: 'GrokConversation', protocol: "GET" },
		'google.com': { bot: 'google', networkID: 'ResolveDriveResource', contentType: 'application/json', protocol: "POST" },
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
	if (request.request.url.includes("claude") && request.request.url.includes("latest")) return false;
	if (request.request.url.includes("chatgpt") && (request.request.url.includes("textdocs") || request.request.url.includes("stream_status"))) return false;
	if (contentType) {
		const contentTypeHeader = request.response.headers.find(header => header.name.toLowerCase() === 'content-type');
		return contentTypeHeader?.value.includes(contentType);
	}
	return true;
}

const processors = {
	kimi: async (response) => {
		let data = JSON.parse(response);
		const chat_list = data['items'];
		const title = chat_list[0].content;
		const created = chat_list[0]['created_at'].slice(0, 10);
		const dialogue = chat_list.map(chat => ({
			type: chat.role === 'user' ? 'PROMPT' : 'BOT',
			text: chat.content,
			...chat.search_citation && {
				sources: Object.values(chat.search_citation).map(serp => ({
					name: serp.site_name,
					url: serp.url
				}))
			}
		}));

		return { title, dialogue, created };
	},
	grok: async (response) => {
		let { data } = JSON.parse(response);
		const chat_list = data['grok_conversation_items_by_rest_id']['items'].reverse();
		const title = chat_list[0].message;
		const created = new Date(chat_list[0].created_at_ms).toISOString().slice(0, 10);
		const dialogue = chat_list.map(chat => ({
			type: chat.sender_type === 'User' ? 'PROMPT' : 'BOT',
			text: chat.message,
			sources: chat.web_results?.map(serp => ({
				name: serp.title,
				url: serp.url
			})) || []
		}));

		return { title, dialogue, created };
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
				{ type: 'PROMPT', text: chat.question },
				{
					type: 'BOT',
					text: chat.answer.replace(/\[\[(\d+)\]\]/g, "[$1]"),
					botName: chat.ai_model || chat.chat_mode || '',
					sources: chat.serp_results?.map(serp => ({
						name: serp.name,
						url: serp.url
					})) || []
				}
			]);
		return { title, dialogue };
	},
	minimax: async (response) => {
		const data = JSON.parse(response).data;
		const title = data.title;
		const created = new Date(data.messages[0].createTime).toISOString().slice(0, 10);
		const dialogue = data.messages.map(message => {
			if (message.msgType === 'user') {
				return { type: 'PROMPT', text: message.content };
			} else if (message.msgType === 'system') {
				return {
					type: 'BOT',
					text: message.content
				};
			}
			return null;
		}).filter(item => item !== null);
		return { title, dialogue, created };
	},
	claude: async (response) => {
		const data = JSON.parse(response);
		const title = data.name;
		const created = data.created_at.slice(0, 10);
		const dialogue = claude2Tree(data.chat_messages);
		return { title, dialogue, created };
	},
	google: async (response) => {
		const data = JSON.parse(response);
		const title = data[0][4][0].trim();
		const dialogueRaw = data[0].at(-1)[0]
			.filter(chat => typeof chat[0] === 'string')
			.map(chat => ({
				type: chat.some(item => item === 'user') ? 'PROMPT' : 'BOT',
				text: chat[0],
			}));
		// if a 'BOT' message is followed by another 'BOT' message, they should be merged.
		const dialogue = [];
		for (let i = 0; i < dialogueRaw.length; i++) {
			if (dialogueRaw[i].type === 'PROMPT') {
				dialogue.push(dialogueRaw[i]);
			} else if (dialogueRaw[i].type === 'BOT' && dialogueRaw[i + 1] && dialogueRaw[i + 1].type === 'BOT') {
				dialogue.push({ type: dialogueRaw[i].type, text: "(NOTES)\n\n" + dialogueRaw[i].text + "\n\n(/NOTES)\n\n" + dialogueRaw[i + 1].text });
				i++; // jump the next 'BOT' message
			} else {
				dialogue.push(dialogueRaw[i]);
			}
		}
		return { title, dialogue };
	},
	chatgpt: async (response) => {
		const data = JSON.parse(response);
		const title = data.title;
		const createdUnix = data.create_time * 1000;
		const created = new Date(createdUnix).toISOString().slice(0, 10);
		let messages = [];
		let mapping = data.mapping;
		let dialogue;
		dialogue = chatgpt2Tree(mapping);
		return { title, dialogue, created };
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
				type: 'BOT',
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
				{ type: 'PROMPT', text: entry[0].content.query },
				standardEntry
			];
		}).flat();
		return { title, dialogue };
	}
};

function updateUI({ title, created = null, dialogue }) {
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
	const dashedDate = now.toISOString().replace("T","_").substring(0,19);
	const shortDate = dashedDate.replace(/[^0-9]/g, "").substring(0,8);
	const rinseTitle = titleClean.split(' ')
		.map(item => item.trim())
		.filter((word) => !stopwords.has(word.toLowerCase()))
		.reduce((shortened, word) =>
			shortened.length + word.length + 1 <= 50 ? shortened + word + ' ' : shortened, '')
		.trim();
	const condensedTitle = rinseTitle.toLowerCase().trim().replace(/ /g, "_");
	const slug = `prt-${(created_at ? created_at.replace(/[^0-9]/g, "") : shortDate).slice(2)}-${hostUrl.replace(/[^a-zA-Z0-9]/g, '').substring(0,2)}${fullUrl.replace(/[^a-zA-Z0-9]/g, '').slice(-4)}-${condensedTitle}`;
	const frontmatter = `---
title: "${rinseTitle}"
tags: []
pagetitle: "${titleClean}"
bot: "${hostUrl}"
profile: "${document.getElementById('profileInput')?.value || ''}"
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
const checksum = str =>
  (str.match(/\d+/g) || []).reduce((sum, n) => sum + Number(n), 0);

function createMarkdown(standardData) {
	let unique_id = Math.random().toString(36).substring(2, 6);
	let inquiry = '## Index\n\n';
	let index = 0;
	let prevTurnIdLength = 0;
	let prevCaretCount = 0;
	const icons = ["🟩", "🟨", "🟥", "🟪", "🟦"];
  const iconLast = ["🟢", "🟡", "🔴", "🟣", "🔵"];
	let chat = standardData.map(section => {
		let markdown = '';
		if (section.type === 'PROMPT') {
			index++;
			let path = "|"+index+"|";
			let icon = "";
			const allWords = section.text.split(/\s+/);
			const words = allWords.length > 60 
				? allWords.slice(0, 30).join(' ') + ' ... ' + allWords.slice(allWords.length - 29).join(' ')
				: allWords.join(' ');
			if (section.turnId) {
					path = section.turnId
					let caretCount = (path.match(/\^/g) || []).length;
					if (prevTurnIdLength > checksum(path)){
						icon = iconLast[((caretCount-1) % iconLast.length)];
					}else if(prevCaretCount < caretCount) {
						icon = icons[((caretCount-1) % icons.length)];
					}
					prevTurnIdLength = checksum(path);
					prevCaretCount = caretCount;
			}
			inquiry += `[**${path}**](#p${path}_${unique_id})${icon}\n${words}\n\n`;
			markdown += `***\n\n**${path}** <a id="p${path}_${unique_id}"></a>\n\n***\n\n**${section.type}** >>>>>>>\n\n${section.text}\n`;
		} else {
			markdown += `***\n\n**${section.type}** >>>>>>\n\n${section.text}\n`;
			if (section.sources && section.sources.length > 0) {
				markdown += '\n**SOURCES** >>>>>>\n\n' + section.sources.map((source, index) => `${index + 1}. [${source.name}](${source.url})`).join('\n') + '\n';
			}
			if (section.related && section.related.length > 0) {
				markdown += '\n**RELATED** >>>>>>\n\n' + section.related.map(query => `> [${query.name}](${query.url})`).join('\n\n') + '\n';
			}
			markdown += '\n[INDEX^](#index)\n';
		}
		return markdown;
	}).join('\n');
	return inquiry + chat
}

// Modal functionality
document.querySelector('.info-icon').addEventListener('click', () => {
	document.getElementById('infoModal').style.display = 'flex';
});

document.getElementById('closeModal').addEventListener('click', () => {
	document.getElementById('infoModal').style.display = 'none';
});