// frameact/stricterdom — DEV phase checks at the DOM-API level with effect attribution (spec §3.4).
// Every function is a thin wrapper in production (`DEV` false): the detectors, the observer and
// the layout-cause table are dead code there.
export {
  enableStrict, disableStrict, isStrictEnabled, forceMeasure, forceMutation, suppressStrict, setHandler,
  StrictViolationError, IGNORE_SUBTREE_ATTR, type StrictErrorHandler, type StrictViolationKind,
} from './stricterdom';
export { LAYOUT_CAUSES, type LayoutCauses } from './layoutCauses';
