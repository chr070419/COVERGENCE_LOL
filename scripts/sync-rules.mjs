import {readFileSync,writeFileSync} from 'node:fs';
for (const name of ['core','history-core','import-core','player-stats']) writeFileSync(new URL('../public/'+name+'.js',import.meta.url),readFileSync(new URL('../domain/'+name+'.cjs',import.meta.url)));
