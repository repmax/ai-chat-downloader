// Copyright 2023 Google LLC
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     https://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

const types = {};
let data = '';
chrome.devtools.inspectedWindow.getResources((resources) => {
	resources.forEach((resource) => {
		if (!(resource.type in types)) {
			types[resource.type] = 0;
		}
		types[resource.type] += 1;
	});
	let result = `Resources on this page: 
  ${Object.entries(types)
			.map((entry) => {
				const [type, count] = entry;
				return `${type}: ${count}`;
			})
			.join('\n')}`;
	document.getElementById('response').textContent = result;
});
chrome.devtools.network.onRequestFinished.addListener(
	function (request) {
		if (request.request.url.startsWith('https://you.com/api/streamingSavedChat')) {
			request.getContent(function (content, encoding) {
				const events = content.split('\n\n');
				for (const event of events) {
					if (event.startsWith('event: youChatCachedChat')) {
						const dataString = event.split('\n')[1].substring(5); // Remove 'data: ' prefix
						try {
							data = JSON.parse(dataString).chat_title;
							// adding text to already existing element
							document.getElementById('response').textContent = data;
							/*
							// creating a textarea that can easily be copied
						const textArea = document.createElement('textarea');
						textArea.value = data;
						document.body.appendChild(textArea);
						textArea.select();
				*/
							// active tab
							chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
								if (tabs && tabs.length > 0) {
									const activeTabId = tabs[0].id;
									console.log('scripting');
									chrome.scripting.executeScript({
										target: { tabId: activeTabId },
										function: (data) => {
											console.log('activetab');
											const copyButton = document.createElement('button');
											copyButton.textContent = 'copy data to clipboard';
											copyButton.style = 'top: 10px; position: absolute';
											copyButton.addEventListener('click', () => {
												console.log('copying');
												navigator.clipboard.writeText(data);
											},
											);
											document.body.appendChild(copyButton);
										},
										args: [data],
										});
								}
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
);

