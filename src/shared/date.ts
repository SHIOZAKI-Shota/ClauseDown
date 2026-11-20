export const pad2 = (n: number) => String(n).padStart(2, '0')

export const localYmd = (d = new Date(), sep = '-') => `${d.getFullYear()}${sep}${pad2(d.getMonth() + 1)}${sep}${pad2(d.getDate())}`

export const localHm = (d: Date, sep = ':') => `${pad2(d.getHours())}${sep}${pad2(d.getMinutes())}`

export const localHms = (d: Date, sep = '') => `${localHm(d, sep)}${sep}${pad2(d.getSeconds())}`

export const todayISO = () => localYmd()
