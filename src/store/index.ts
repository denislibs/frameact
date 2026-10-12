// frameact/store — a global store on signals (spec §3.5): a tree of plain objects whose properties
// become signals lazily; path writes notify one leaf; store-caused DOM updates wait for heavy
// animations (gate.ts, installed by this import).
import './gate';
export { reconcile, type ReconcileOptions, type Mutable } from './reconcile';
export {
  createStore, merge, produce, unwrap, snapshot, $RAW, $TRACK,
  type Store, type StoreArray, type SetStoreFunction, type Updater, type Merger, type Part, type At,
} from './store';
