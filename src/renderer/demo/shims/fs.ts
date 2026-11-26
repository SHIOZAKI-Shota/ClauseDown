const missing = (path: unknown) => {
	throw new Error(`demo: cannot read ${String(path)}`)
}
export const existsSync = () => false
export const readFileSync = missing
export const writeFileSync = missing
export const createReadStream = missing
export const createWriteStream = missing
export default { existsSync, readFileSync, writeFileSync, createReadStream, createWriteStream }
