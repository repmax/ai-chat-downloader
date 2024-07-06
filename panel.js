const youButton = document.querySelector('#yousearch');
youButton.addEventListener('click', () => {
	let activeTabId;
	chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
		if (tabs && tabs.length > 0) {
			activeTabId = tabs[0].id;
		}
	})
	chrome.devtools.network.onRequestFinished.addListener(
		function (request) {
			if (request.request.url.startsWith('https://you.com/api/streamingSavedChat')) {
				console.log("request streamingSavedChat", request);
				request.getContent((content) => {
					console.log("request.getContent", content);
					const events = content.split('\n\n');
					for (const event of events) {
						if (event.startsWith('event: youChatCachedChat')) {
							const dataString = event.split('\n')[1].substring(5);
							try {
								// adding buttons to active tab
								const inputElement = document.getElementById('tagInput');
								const tags = inputElement.value.trim();
								chrome.scripting.executeScript({
									target: { tabId: activeTabId },
									function: (dataString, tags) => {
										console.log('activetab');
										const frontMaker = (titleRaw) => {
											const stopwords = ['i', 'write', 'you', 'me', 'the', 'is', 'are', 'for', 'in', 'this', 'who', 'what', 'when', 'how', 'why', 'should', 'can', 'did', 'do', 'tell', 'write', 'act', 'as', 'a', 'an'];
											const titleClean = titleRaw.replace(/[^a-zA-Z0-9 ]/g, "").replace(/\s+/g, ' ').substring(0, 45);
											const now = new Date();
											const dashedDate = now.toISOString().substring(0, 10);
											const shortDate = dashedDate.replace(/[^0-9]/g, "");
											const full_url = document.location.href;
											const splitTitle = titleClean.toLowerCase().split(' ').filter((item) => !stopwords.includes(item));
											const condensedTitle = splitTitle.join(" ").substring(0, 30).trim().replace(/ /g, "_");
											const slug = `prmt-${condensedTitle}-${shortDate}`;
											const frontmatter = `---
title: "${titleClean}"
author: 
tags: [${tags}]
pagetitle: "${titleClean}"
bot: "${document.location.host}"
type: aichat
source: ${full_url}
slug: ${slug}
saved: ${dashedDate}
created: 
---

# ${titleClean}

Link: [${document.location.host.replace("www.", "")}](${full_url})

`;
											return { frontmatter, slug }
										}
										// create markdown
										let data = JSON.parse(dataString, tags);
										const titleRaw = data.chat[0].question;
										({ frontmatter, slug } = frontMaker(titleRaw));

										let mdtext = frontmatter + "\n***\n";
										mdtext += data.chat.map(chat => {
											let item = `\nPROMPT >>>>>>\n\n${chat.question}\n\nBOT [${chat.ai_model}] >>>>>>\n\n${chat.answer}\n`;
											if (chat.serp_results && chat.serp_results.length > 0) {
												item += `\nSOURCES:\n${chat.serp_results.map((serp => `- [${serp.name}](${serp.url})`)).join("\n")}`;
											}
											return item;
										}).join("\n***\n");
										// download as a file button
										const downButton = document.createElement('button');
										downButton.textContent = 'Download File';
										downButton.classList.add('devtools-button');
										downButton.addEventListener('click', () => {

											const downFile = async (filename, markdown) => {
												try {
													const myhandle = await getNewFileHandle(filename);
													return writeFile(myhandle, markdown);
												} catch {
													const blob = new Blob([markdown], { type: "text/plain" });
													const link = document.createElement("a");
													link.download = filename + ".md";
													link.href = window.URL.createObjectURL(blob);
													link.click();
													// Remove the link element from the DOM
													link.remove();
												}
											};

											const writeFile = async (fileHandle, contents) => {
												// Create a FileSystemWritableFileStream to write to.
												const writable = await fileHandle.createWritable();
												// Write the contents of the file to the stream.
												await writable.write(contents);
												// Close the file and write the contents to disk.
												await writable.close();
											};

											const getNewFileHandle = async (filename) => {
												const options = {
													suggestedName: filename + ".md",
													types: [{
														description: "Text Files",
														accept: {
															"text/plain": [".md"],
														},
													},],
												};
												const handle = await window.showSaveFilePicker(options);
												return handle;
											};
											console.log('downloading');
											downFile(slug, mdtext);
											downButton.remove();
										});
										// Copy to clipboard
										const copyButton = document.createElement('button');
										copyButton.textContent = 'Copy Clipboard';
										copyButton.classList.add('devtools-button');
										copyButton.addEventListener('click', async () => {
											console.log('copying');
											await navigator.clipboard.writeText(mdtext);
											copyButton.remove();
										});
										// Prepare styling
										const style = document.createElement('style');
										style.textContent = `
  .devtools-button {
    background-color: #4285f4;
    color: white;
    border: none;
    border-radius: 4px;
    padding: 8px 16px;
    font-size: 14px;
    font-weight: 500;
    cursor: pointer;
    transition: background-color 0.2s;
    margin-right: 10px;
  }

  .devtools-button:hover {
    background-color: #3367d6;
  }

  .button-container {
    position: fixed;
    top: 10px;
    right: 10px;
    display: flex;
    z-index: 9999;
  }
`;
										document.head.appendChild(style);
										// Container for the buttons
										const buttonContainer = document.createElement('div');
										buttonContainer.classList.add('button-container');
										buttonContainer.appendChild(downButton);
										buttonContainer.appendChild(copyButton);
										document.body.appendChild(buttonContainer);
									},
									args: [dataString, tags]
								})
							} catch (error) {
								console.error('Error parsing JSON:', error);
							}
							break;
						}
					}
				});
			}
		}
	)
	chrome.tabs.reload(activeTabId)
});