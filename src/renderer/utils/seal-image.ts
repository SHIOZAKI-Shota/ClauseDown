export async function canvasPng(canvas: HTMLCanvasElement): Promise<Uint8Array> {
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
    if (!blob) throw new Error('png')
    return new Uint8Array(await blob.arrayBuffer())
}

function loadImage(url: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
        const img = new Image()
        img.onload = () => resolve(img)
        img.onerror = () => reject(new Error('image'))
        img.src = url
    })
}

export async function svgToPng(svg: string, px = 600): Promise<Uint8Array> {
    const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }))
    try {
        const img = await loadImage(url)
        const canvas = document.createElement('canvas')
        canvas.width = px
        canvas.height = px
        canvas.getContext('2d')!.drawImage(img, 0, 0, px, px)
        return await canvasPng(canvas)
    } finally {
        URL.revokeObjectURL(url)
    }
}

export async function imageToPng(file: Blob, transparent: boolean, threshold = 230, maxPx = 1200): Promise<Uint8Array> {
    const url = URL.createObjectURL(file)
    try {
        const img = await loadImage(url)
        const scale = Math.min(1, maxPx / Math.max(img.naturalWidth, img.naturalHeight))
        const canvas = document.createElement('canvas')
        canvas.width = Math.max(1, Math.round(img.naturalWidth * scale))
        canvas.height = Math.max(1, Math.round(img.naturalHeight * scale))
        const ctx = canvas.getContext('2d')!
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
        if (transparent) {
            const data = ctx.getImageData(0, 0, canvas.width, canvas.height)
            const px = data.data
            for (let i = 0; i < px.length; i += 4) {
                const light = Math.min(px[i], px[i + 1], px[i + 2])
                if (light >= threshold) px[i + 3] = 0
                else if (light > threshold - 40) px[i + 3] = Math.round((px[i + 3] * (threshold - light)) / 40)
            }
            ctx.putImageData(data, 0, 0)
        }
        return await canvasPng(canvas)
    } finally {
        URL.revokeObjectURL(url)
    }
}

export const pngUrl = (png: Uint8Array) => URL.createObjectURL(new Blob([png as Uint8Array<ArrayBuffer>], { type: 'image/png' }))
