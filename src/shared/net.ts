const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]'])

export const isLoopbackHost = (hostname: string) => LOOPBACK.has(hostname)
