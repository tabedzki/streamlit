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

import { memo, type ReactElement, useEffect, useRef } from "react"

import type { Toast as ToastProto } from "@streamlit/protobuf"
import { notNullOrUndefined } from "@streamlit/utils"

import AlertElement from "~lib/components/elements/AlertElement/AlertElement"
import { Kind } from "~lib/components/shared/AlertContainer/AlertContainer"
import { useEmotionTheme } from "~lib/hooks/useEmotionTheme"

import { getToastContent, toastQueue, updateToastContent } from "./toastQueue"

export interface ToastProps {
  element: ToastProto
  /**
   * Stable identity of this toast (its delta path). Toasts at the same position
   * across reruns share a `toastId`; distinct `st.toast()` calls do not.
   */
  toastId: string
}

function Toast({
  element,
  toastId,
}: Readonly<ToastProps>): ReactElement | null {
  const { body, icon, duration } = element
  const theme = useEmotionTheme()
  // Key of the queued toast this element controls, so that updates
  // (`msg = st.toast(...)` followed by `msg.toast(...)`) apply to it.
  const toastKeyRef = useRef<string | null>(null)

  useEffect(() => {
    if (theme.inSidebar) {
      return
    }

    // duration=null/undefined → 4s default; duration=0 → undefined (persistent); duration>0 → ms
    const timeout = notNullOrUndefined(duration)
      ? duration === 0
        ? undefined
        : duration * 1_000
      : 4_000
    const content = { body, icon: icon || undefined, toastId, timeout }

    if (toastKeyRef.current === null) {
      // Identify toasts by position: if a toast for this delta path is already
      // visible, this is a remount caused by a rerun re-emitting the toast (the
      // component is keyed by scriptRunId), so it is applied to the existing
      // toast instead of stacking a duplicate: identical content leaves the
      // toast and its timer untouched, while different content restarts it
      // (e.g. clicking a button again while the previous run's toast is still
      // visible). Distinct st.toast() calls live at distinct delta paths, so
      // this never merges legitimately separate toasts.
      //
      // Caveat: toastId is the delta path, which is a *position* in the shared
      // EVENT container (toasts and dialogs are interleaved there by call
      // order). If another EVENT element (e.g. a conditionally-shown st.dialog
      // declared before a toast) changes this toast's index across reruns while
      // the toast is still visible, it looks like a new position and can
      // briefly show a duplicate. This is a rare, self-healing edge case
      // (toasts auto-expire); identifying toasts by their parameters would
      // avoid it but would also collapse intentionally-identical toasts (e.g.
      // the "Three cheers" example).
      const existing = toastQueue.visibleToasts.find(
        toast => toast.content.toastId === toastId
      )
      if (!existing) {
        // Intentionally no unmount cleanup: a toast's lifetime is governed by
        // its react-aria timeout (or manual dismissal), not the React component
        // lifecycle. This lets a toast survive the stale-node unmount that
        // happens when st.toast() is immediately followed by st.rerun() (issue
        // #7740).
        toastKeyRef.current = toastQueue.add(content, { timeout })
        return
      }
      toastKeyRef.current = existing.key
    }

    // Apply the content to the controlled toast: either a re-emission in a new
    // run (see above) or an in-place update within the same run
    // (`msg.toast(...)`). Updates to a toast that was already dismissed or has
    // expired are not shown.
    const current = toastQueue.visibleToasts.find(
      toast => toast.key === toastKeyRef.current
    )
    if (!current) {
      return
    }
    const shown = getToastContent(current)
    if (
      shown.body === content.body &&
      shown.icon === content.icon &&
      shown.timeout === content.timeout
    ) {
      return
    }
    // A react-aria toast either has a timer or not for its whole lifetime, so
    // switching between a timed and an infinite duration replaces the toast.
    if (Boolean(current.timer) !== notNullOrUndefined(timeout)) {
      toastQueue.close(current.key)
      toastKeyRef.current = toastQueue.add(content, { timeout })
      return
    }
    updateToastContent(current.key, content)
    // Like a newly shown toast, an update restarts the auto-hide timer.
    // react-aria's Timer.reset() does not clear the pending timeout, so pause it
    // first.
    if (notNullOrUndefined(timeout)) {
      current.timer?.pause()
      current.timer?.reset(timeout)
    }

    // theme.inSidebar and toastId are fixed for a mounted Toast: the component
    // is keyed by scriptRunId and toastId is its delta path.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [body, icon, duration])

  const sidebarErrorMessage = (
    <AlertElement
      kind={Kind.ERROR}
      body="Streamlit API Error: `st.toast` cannot be called directly on the sidebar with `st.sidebar.toast`.
        See our `st.toast` API [docs](https://docs.streamlit.io/develop/api-reference/status/st.toast) for more information."
    />
  )

  return theme.inSidebar ? sidebarErrorMessage : null
}

export default memo(Toast)
