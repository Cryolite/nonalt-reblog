import { Image, fetchImages } from '../common'
import { executeScript, createTab } from '../background/common'

async function expandPixivArtworks(tabId: number): Promise<void> {
    await executeScript({
        target: {
            tabId: tabId
        },
        func: () => {
            function expandImpl(element: Element): void {
                checkAndClick: {
                    if (element.nodeName !== 'DIV') {
                        break checkAndClick;
                    }
                    const div = element as HTMLDivElement;

                    const innerText = div.innerText;
                    if (innerText.search(/^\d+\/\d+$/) === -1) {
                        break checkAndClick;
                    }

                    const onclick = div.onclick;
                    if (onclick === null) {
                        break checkAndClick;
                    }

                    div.click();
                    return;
                }

                for (const child of element.children) {
                    expandImpl(child);
                }
            }

            expandImpl(document.body);
        },
        world: 'MAIN'
    });
}

async function getPixivArtistUrl(tabId: number): Promise<string | null> {
    const artistUrl = await executeScript({
        target: {
            tabId: tabId
        },
        func: () => {
            function impl(element: Element): string | null {
                checkElement: {
                    if (element.nodeName !== 'A') {
                        break checkElement;
                    }
                    const anchor = element as HTMLAnchorElement;

                    const innerText = anchor.innerText;
                    if (innerText !== '作品一覧を見る') {
                        break checkElement;
                    }

                    const href = anchor.href;
                    const pattern = /^(https:\/\/www\.pixiv\.net\/users\/\d+)\/artworks$/;
                    const match = pattern.exec(href);
                    if (match === null) {
                        break checkElement;
                    }
                    if (/^https:\/\/www\.pixiv\.net\/users\/\d+$/.test(match[1]) !== true) {
                        throw new Error(`${match[1]}: An unexpected artist URL.`);
                    }

                    return match[1];
                }

                const children = element.children;
                if (typeof children !== 'object') {
                    return null;
                }
                for (const child of children) {
                    const result = impl(child);
                    if (typeof result === 'string') {
                        return result;
                    }
                }
                return null;
            }

            return impl(document.body);
        },
        world: 'MAIN'
    });
    return artistUrl;
}

async function getPixivImagesImpl(tabId: number, sourceUrl: string, images: Image[]): Promise<void> {
    const newTab = await createTab({
        openerTabId: tabId,
        url: sourceUrl,
        active: false
    }, 60 * 1000);
    const newTabId = newTab.id!;

    const artistUrl = await getPixivArtistUrl(newTabId);
    if (typeof artistUrl !== 'string') {
        console.warn(`${sourceUrl}: Failed to get artist URL.`);
        chrome.tabs.remove(newTabId);
        return;
    }

    await expandPixivArtworks(newTabId);

    const linkUrls = await executeScript({
        target: {
            tabId: newTabId
        },
        func: () => {
            const links = [];
            for (let i = 0; i < document.links.length; ++i) {
                const link = document.links[i];
                const href = link.href;
                links.push(href);
            }
            return links;
        },
        world: 'MAIN'
    });

    const imageUrlPattern = /^https:\/\/i\.pximg\.net\/img-original\/img\/\d{4}(?:\/\d{2}){5}\/\d+_p0\.\w+/;
    const imageUrls = [];
    for (const imageUrl of linkUrls) {
        if (imageUrl.search(imageUrlPattern) === -1) {
            continue;
        }
        imageUrls.push(imageUrl);
    }

    const imageUrlsUniqued = [...new Set(imageUrls)];
    const newImages = await fetchImages(imageUrlsUniqued, sourceUrl);
    for (const newImage of newImages) {
        images.push({
            ...newImage,
            artistUrl
        });
    }

    chrome.tabs.remove(newTabId);
}

export async function getImages(tabId: number, hrefs: string[], innerText: string): Promise<Image[]> {
    const sourceUrls = [];
    {
        const sourceUrlPattern = /^https:\/\/href\.li\/\?https:\/\/(?:www\.)?pixiv\.net(?:\/en)?(\/artworks\/\d+)/;
        for (const href of hrefs) {
            const matches = sourceUrlPattern.exec(href);
            if (!Array.isArray(matches)) {
                continue;
            }
            sourceUrls.push('https://www.pixiv.net' + matches[1]);
        }
    }
    {
        const sourceUrlPattern = /^https:\/\/href\.li\/\?http:\/\/www\.pixiv\.net\/member_illust\.php\?mode=[^&]+&illust_id=(\d+)/;
        for (const href of hrefs) {
            const matches = sourceUrlPattern.exec(href);
            if (!Array.isArray(matches)) {
                continue;
            }
            sourceUrls.push('https://www.pixiv.net/artworks/' + matches[1]);
        }
    }

    const images: Image[] = [];
    for (const sourceUrl of [...new Set(sourceUrls)]) {
        try {
            await getPixivImagesImpl(tabId, sourceUrl, images);
        } catch (error: unknown) {
            console.error(error as Error);
        }
    }
    return images;
}
