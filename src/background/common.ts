export async function executeScript<Args extends unknown[], Result>(scriptInjection: chrome.scripting.ScriptInjection<Args, Result>) {
    const injectionResults = await chrome.scripting.executeScript(scriptInjection);
    console.assert(injectionResults.length === 1, injectionResults.length);
    if (injectionResults.length === 0) {
        const error = new Error('Script injection failed.');
        throw error;
    }
    if (injectionResults.length >= 2) {
        const error = new Error(`Unintended script injection into ${injectionResults.length} frames.`);
        throw error;
    }
    const injectionResult = injectionResults[0];
    return injectionResult.result;
}

export function printInfo(tabId: number, message: string): void {
    executeScript({
        target: {
            tabId: tabId
        },
        func: message => console.info(message),
        args: [message]
    });
}

export function printWarning(tabId: number, message: string): void {
    executeScript({
        target: {
            tabId: tabId
        },
        func: message => console.warn(message),
        args: [message]
    });
}

export function printError(tabId: number, message: string): void {
    executeScript({
        target: {
            tabId: tabId
        },
        func: message => console.error(message),
        args: [message]
    });
}

/**
 * Create a new tab and wait for the resource loading for the page on that tab
 * to complete.
 * 
 * @module common
 * @param createProperties - See {@link https://developer.chrome.com/docs/extensions/reference/tabs/#method-create createProperties}.
 * @param timeout - The time in milliseconds until forcibly cancelling the resource loading of the page in the tab.
 * @return - A {@link https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise Promise} that resolves to a tab object.
 *           When timeout occurs during resource loading, the tab is removed and the Promise is rejected. 
 */
export async function createTab(createProperties: chrome.tabs.CreateProperties, timeout: number): Promise<chrome.tabs.Tab> {
    if (createProperties.openerTabId !== undefined && createProperties.windowId === undefined) {
        const openerTabId = createProperties.openerTabId;
        const openerTab = await chrome.tabs.get(openerTabId);
        const windowId = openerTab.windowId;
        createProperties.windowId = windowId;
    }

    const tab = await chrome.tabs.create(createProperties);
    const tabId = tab.id!;

    const promise = new Promise<chrome.tabs.Tab>(async (resolve, reject) => {
        const timeoutId = setTimeout(async () => {
            await executeScript({
                target: {
                    tabId: tabId
                },
                func: () => window.stop(),
                world: 'MAIN'
            });
            chrome.tabs.remove(tabId);
            reject(new Error('Failed to create a tab due to timeout in resource loading.'));
        }, timeout);
        chrome.webNavigation.onCompleted.addListener(details => {
            if (details.tabId !== tabId) {
                return;
            }
            clearTimeout(timeoutId);
            resolve(tab);
        });
    });

    return promise;
}
