export async function sleep(milliseconds) {
    if (typeof milliseconds !== 'number') {
        console.assert(typeof milliseconds === 'number', typeof milliseconds);
        throw new Error(`${typeof milliseconds}: An invalid type.`);
    }

    const promise = new Promise((resolve, reject) => {
        setTimeout(() => {
            resolve();
        }, milliseconds);
    });
    return promise;
}
