import { spawnSync } from 'node:child_process'
import os from 'node:os'

const env = { ...process.env, RUSTFLAGS: `--remap-path-prefix=${os.homedir()}=~` }

for (const name of ['myna', 'keychip']) {
	const r = spawnSync(`npx napi build --release --platform --cwd native/${name} --output-dir .`, { stdio: 'inherit', env, shell: true })
	if (r.status !== 0) process.exit(r.status ?? 1)
}
