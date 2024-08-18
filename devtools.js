chrome.devtools.panels.create('Chat Extractor', "data:image/svg+xml;base64," + btoa('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24"><rect width="24" height="24" rx="4" fill="#4285f4"/><path d="M5 5h10c1.1 0 2 .9 2 2v6c0 1.1-.9 2-2 2h-2.5l-2.5 2.5-2.5-2.5H5c-1.1 0-2-.9-2-2V7c0-1.1.9-2 2-2z" fill="white"/><path d="M18 14l3 3-3 3" stroke="white" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>'), 'panel.html', ()=>{
    console.log('Chat Extraction devtools panel open');
}
);
