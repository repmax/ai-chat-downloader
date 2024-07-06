const youButton = document.querySelector('#yousearch');

youButton.addEventListener('click', () => {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (!tabs || tabs.length === 0) return;

    const activeTabId = tabs[0].id;

    chrome.devtools.network.onRequestFinished.addListener(async (request) => {
      if (!request.request.url.startsWith('https://you.com/api/streamingSavedChat')) return;

      const content = await new Promise((resolve) => request.getContent(resolve));
      const events = content.split('\n\n');

      const chatEvent = events.find(event => event.startsWith('event: youChatCachedChat'));
      if (!chatEvent) return;

      try {
        const dataString = chatEvent.split('\n')[1].substring(5);
        const inputElement = document.getElementById('tagInput');
        const tags = inputElement.value.trim();

        const data = JSON.parse(dataString);
        const titleRaw = data.chat[0].question;
        const { frontmatter, slug } = createFrontMatter(titleRaw, tags);

        const markdown = createMarkdown(data, frontmatter);

        createDevtoolsButtons(markdown, slug, activeTabId);

        chrome.tabs.reload(activeTabId);
      } catch (error) {
        console.error('Error processing chat data:', error);
      }
    });
  });
});

function createFrontMatter(titleRaw, tags) {
  const stopwords = ['i', 'write', 'you', 'me', 'the', 'is', 'are', 'for', 'in', 'this', 'who', 'what', 'when', 'how', 'why', 'should', 'can', 'did', 'do', 'tell', 'write', 'act', 'as', 'a', 'an'];
  const titleClean = titleRaw.replace(/[^a-zA-Z0-9 ]/g, "").replace(/\s+/g, ' ').substring(0, 45);
  const now = new Date();
  const dashedDate = now.toISOString().substring(0, 10);
  const shortDate = dashedDate.replace(/[^0-9]/g, "");
  const fullUrl = document.location.href;
  const splitTitle = titleClean.toLowerCase().split(' ').filter((item) => !stopwords.includes(item));
  const condensedTitle = splitTitle.join(" ").substring(0, 30).trim().replace(/ /g, "_");
  const slug = `prmt-${condensedTitle}-${shortDate}`;

  return {
    frontmatter: `---
title: "${titleClean}"
author: 
tags: [${tags}]
pagetitle: "${titleClean}"
bot: "${document.location.host}"
type: aichat
source: ${fullUrl}
slug: ${slug}
saved: ${dashedDate}
created: 
---

# ${titleClean}

Link: [${document.location.host.replace("www.", "")}](${fullUrl})

`,
    slug
  };
}

function createMarkdown(data, frontmatter) {
  return frontmatter + "\n***\n" + data.chat.map(chat => {
    let item = `\nPROMPT >>>>>>\n\n${chat.question}\n\nBOT [${chat.ai_model}] >>>>>>\n\n${chat.answer}\n`;
    if (chat.serp_results && chat.serp_results.length > 0) {
      item += `\nSOURCES:\n${chat.serp_results.map((serp => `- [${serp.name}](${serp.url})`)).join("\n")}`;
    }
    return item;
  }).join("\n***\n");
}

function createDevtoolsButtons(markdown, slug, activeTabId) {
  const downloadFile = async (filename, markdown) => {
    try {
      const myhandle = await getNewFileHandle(filename);
      return writeFile(myhandle, markdown);
    } catch {
      const blob = new Blob([markdown], { type: "text/plain" });
      const link = document.createElement("a");
      link.download = filename + ".md";
      link.href = window.URL.createObjectURL(blob);
      link.click();
      link.remove();
    }
  };

  const writeFile = async (fileHandle, contents) => {
    const writable = await fileHandle.createWritable();
    await writable.write(contents);
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
    return window.showSaveFilePicker(options);
  };

  const copyToClipboard = async (text) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch (error) {
      console.error('Failed to copy to clipboard:', error);
    }
  };

  const createButton = (text, clickHandler) => {
    const button = document.createElement('button');
    button.textContent = text;
    button.classList.add('devtools-button');
    button.addEventListener('click', clickHandler);
    return button;
  };

  const downButton = createButton('Download File', () => downloadFile(slug, markdown));
  const copyButton = createButton('Copy Clipboard', () => copyToClipboard(markdown));

  const container = document.createElement('div');
  container.classList.add('devtools-container');
  container.innerHTML = `
    <button class="close-button">
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <line x1="18" y1="6" x2="6" y2="18"></line>
        <line x1="6" y1="6" x2="18" y2="18"></line>
      </svg>
    </button>
  `;
  container.appendChild(downButton);
  container.appendChild(copyButton);

  const style = document.createElement('style');
  style.textContent = `
    .devtools-container {
      position: fixed;
      top: 10px;
      right: 10px;
      background-color: rgba(51,51,51);
      border-radius: 8px;
      padding: 20px;
      padding-top: 40px; 
      z-index: 9999;
    }

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

    .close-button {
      position: absolute;
      top: 10px;
      right: 10px;
      width: 24px;
      height: 24px;
      background-color: #808080;
      border: none;
      border-radius: 4px;
      cursor: pointer;
      display: flex;
      justify-content: center;
      align-items: center;
      padding: 0;
    }

    .close-button svg {
      width: 16px;
      height: 16px;
    }
  `;

  document.head.appendChild(style);
  document.body.appendChild(container);

  container.querySelector('.close-button').addEventListener('click', () => {
    document.body.removeChild(container);
  });
}
