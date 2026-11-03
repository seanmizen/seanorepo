import { undoRedoRoute } from './undo';

/**
 * `POST /orgs/<slug>/redo`: the Redo key. It is the same handler as Undo
 * (`undo.ts`), with the kind `redo`.
 */
export const orgRedoRoute = undoRedoRoute('redo');
