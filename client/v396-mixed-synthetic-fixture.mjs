/* Nonpersonal browser fixture. Retains v3.95 actionable works while adding additional ID shapes. */
import {getV353SyntheticFixture} from './v353-browser-mixed-id-test-only.mjs';
export const V396_EXTRA_JIKAN='jikan:80321';
export const V396_EXTRA_CUSTOM='custom:1729544400400:abcabc';
export const V396_EXTRA_TOMBSTONE='jikan:80322';
export function getV396SyntheticFixture(){
 const s=getV353SyntheticFixture();
 s.records[V396_EXTRA_JIKAN]={id:V396_EXTRA_JIKAN,title:'架空作品・第三作',status:'watching',watchedEpisodes:6,updatedAt:'2026-10-22T01:00:00.000Z',unknownDeep:{nested:[{tag:'preserved'}]}};
 s.records[V396_EXTRA_CUSTOM]={id:V396_EXTRA_CUSTOM,title:'架空の手動登録・第四作',status:'paused',watchedEpisodes:2,updatedAt:'2026-10-22T01:00:00.000Z',inheritedOther:{a:7}};
 s.tombstones[V396_EXTRA_TOMBSTONE]={id:V396_EXTRA_TOMBSTONE,deletedAt:'2026-10-21T01:00:00.000Z',unknownDeleteMeta:{cause:'historical'}};
 return s;
}
