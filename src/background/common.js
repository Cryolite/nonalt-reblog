export async function executeScript(scriptInjection) {
    const injectionResults = await chrome.scripting.executeScript(scriptInjection);
    if (injectionResults.length === 0) {
        console.assert(injectionResults.length === 1, injectionResults.length);
        const error = new Error('Script injection failed.');
        throw error;
    }
    if (injectionResults.length >= 2) {
        console.assert(injectionResults.length === 1, injectionResults.length);
        const error = new Error(`Unintended script injection into ${injectionResults.length} frames.`);
        throw error;
    }
    const injectionResult = injectionResults[0];
    return injectionResult.result;
}

export function printInfo(tabId, message) {
    executeScript({
        target: {
            tabId: tabId
        },
        func: message => console.info(message),
        args: [message]
    });
}

export function printWarning(tabId, message) {
    executeScript({
        target: {
            tabId: tabId
        },
        func: message => console.warn(message),
        args: [message]
    });
}

export function printError(tabId, message) {
    executeScript({
        target: {
            tabId: tabId
        },
        func: message => console.error(message),
        args: [message]
    });
}

// Create a new tab and wait for the resource loading for the page on that tab
// to complete.
export async function createTab(createProperties) {
    if ('openerTabId' in createProperties && 'windowId' in createProperties === false) {
        const openerTabId = createProperties.openerTabId;
        const openerTab = await chrome.tabs.get(openerTabId);
        const windowId = openerTab.windowId;
        createProperties.windowId = windowId;
    }

    const tab = await chrome.tabs.create(createProperties);

    const promise = new Promise((resolve, reject) => {
        chrome.webNavigation.onCompleted.addListener(details => {
            if (details.tabId !== tab.id) {
                return;
            }
            resolve(tab);
        });
    });

    return promise;
}
