const pButton = document.querySelector('#perplexity');

pButton.addEventListener('click', () => {
	// initiate listner
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
					const events = content.split('\n\n');
					for (const event of events) {
						if (event.startsWith('event: youChatCachedChat')) {
							const dataString = event.split('\n')[1].substring(5); // Remove 'data: ' prefix
							try {
								const data = JSON.parse(dataString).chat_title;
								// adding text to already existing element
								const responseContainer = document.getElementById('response');
								const textArea = document.createElement('textarea');
								textArea.value = data;
								responseContainer.appendChild(textArea);
								textArea.select();
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
										});
										document.body.appendChild(copyButton);
									},
									args: [data]
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