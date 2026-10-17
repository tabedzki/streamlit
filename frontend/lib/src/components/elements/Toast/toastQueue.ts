/**
 * Copyright (c) Streamlit Inc. (2018-2022) Snowflake Inc. (2022-2026)
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { useSyncExternalStore } from "react"

import {
  type QueuedToast,
  UNSTABLE_ToastQueue as ToastQueue,
} from "react-aria-components/Toast"

/** Content for a standard `st.toast`: a markdown body and optional icon. */
export interface StreamlitToastContent {
  body: string
  icon?: string
  /**
   * Stable identity of the toast within the element tree (its delta path). Set
   * by the `Toast` component and used to de-dupe the same toast across the
   * component remounts that happen on every rerun, so an unconditionally
   * re-emitted toast does not stack up. Optional because it is only relevant to
   * that de-dupe path, not to rendering an individual toast.
   */
  toastId?: string
  /**
   * Auto-hide timeout in milliseconds that the toast was last shown or updated
   * with (`undefined` for a toast without auto-hide). Used to tell whether a
   * re-emitted toast is identical to the visible one.
   */
  timeout?: number
}

export const toastQueue = new ToastQueue<StreamlitToastContent>({
  maxVisibleToasts: Infinity,
})

/**
 * Content set by in-place updates (`msg.toast(...)`), keyed by queued toast
 * key. react-aria's ToastQueue has no update API, and replacing a toast would
 * move it in the stack and reset its UI state, so updated content is kept here
 * and read by the rendered toast instead.
 */
const updatedContents = new Map<string, StreamlitToastContent>()
const contentListeners = new Set<() => void>()

// Drop updated content once its toast has been closed.
toastQueue.subscribe(() => {
  for (const key of updatedContents.keys()) {
    if (!toastQueue.visibleToasts.some(toast => toast.key === key)) {
      updatedContents.delete(key)
    }
  }
})

function subscribeToContentUpdates(listener: () => void): () => void {
  contentListeners.add(listener)
  return () => contentListeners.delete(listener)
}

/** Returns the current content of a queued toast, including updates. */
export function getToastContent(
  toast: QueuedToast<StreamlitToastContent>
): StreamlitToastContent {
  return updatedContents.get(toast.key) ?? toast.content
}

/** Replaces the content of a visible toast without re-queuing it. */
export function updateToastContent(
  key: string,
  content: StreamlitToastContent
): void {
  updatedContents.set(key, content)
  contentListeners.forEach(listener => listener())
}

/** Subscribes a rendered toast to in-place content updates. */
export function useToastContent(
  toast: QueuedToast<StreamlitToastContent>
): StreamlitToastContent {
  return useSyncExternalStore(subscribeToContentUpdates, () =>
    getToastContent(toast)
  )
}
