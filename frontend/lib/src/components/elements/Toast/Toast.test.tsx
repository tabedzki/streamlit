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

import type { ReactElement } from "react"

import { act, type RenderResult, screen, within } from "@testing-library/react"
import { userEvent } from "@testing-library/user-event"
import { UNSTABLE_ToastRegion as ToastRegion } from "react-aria-components/Toast"
import { type MockInstance, vi } from "vitest"

import { Toast as ToastProto } from "@streamlit/protobuf"

import ThemeProvider from "~lib/components/core/ThemeProvider"
import { mockTheme } from "~lib/mocks/mockTheme"
import { render } from "~lib/test_util"

import { StreamlitToastItem } from "./StreamlitToastItem"
import Toast, { type ToastProps } from "./Toast"
import { toastQueue } from "./toastQueue"

const createContainer = (): ReactElement => (
  <ToastRegion
    queue={toastQueue}
    aria-label="Notifications"
    data-testid="stToastContainer"
  >
    {({ toast }) => <StreamlitToastItem toast={toast} />}
  </ToastRegion>
)

const getProps = (
  elementProps: Partial<ToastProto> = {},
  toastId = "toast-0"
): ToastProps => ({
  element: ToastProto.create({
    body: "This is a toast message",
    icon: "🐶",
    // Default to no auto-hide in tests to avoid timers leaking past teardown
    duration: 0,
    ...elementProps,
  }),
  toastId,
})

const renderComponent = (props: ToastProps): RenderResult =>
  render(
    <>
      {createContainer()}
      <Toast {...props} />
    </>
  )

const LONG_MESSAGE =
  "Random toast message that is a really really really really really really really really really long message, going way past the 3 line limit"

describe("Toast Component", () => {
  let scrollHeightSpy: MockInstance | undefined
  let getComputedStyleSpy: MockInstance | undefined

  beforeEach(() => {
    // Use fake timers across tests to control and flush internal timeouts
    vi.useFakeTimers()
  })

  afterEach(() => {
    scrollHeightSpy?.mockRestore()
    scrollHeightSpy = undefined
    getComputedStyleSpy?.mockRestore()
    getComputedStyleSpy = undefined
    // Clear all toasts and flush timers to avoid updates after test teardown
    act(() => {
      toastQueue.visibleToasts.forEach(t => toastQueue.close(t.key))
    })

    // Ensure any pending toast timers are executed and then cleared
    act(() => {
      vi.runOnlyPendingTimers()
    })
    vi.clearAllTimers()
    vi.useRealTimers()
  })

  function simulateOverflow(): void {
    scrollHeightSpy = vi
      .spyOn(HTMLElement.prototype, "scrollHeight", "get")
      .mockImplementation(function (this: HTMLElement) {
        if (this.dataset.testid === "stToastText") {
          return 100
        }
        return 0
      })
    const realGetComputedStyle = window.getComputedStyle.bind(window)
    getComputedStyleSpy = vi
      .spyOn(window, "getComputedStyle")
      .mockImplementation((el, pseudoElt) => {
        if (el instanceof HTMLElement && el.dataset.testid === "stToastText") {
          return { lineHeight: "20px" } as CSSStyleDeclaration
        }
        return realGetComputedStyle(el, pseudoElt)
      })
  }

  it("renders default toast", () => {
    const props = getProps()
    renderComponent(props)

    const toast = screen.getByRole("alertdialog")
    const closeButton = screen.getByRole("button", { name: "Close" })
    const expandButton = screen.queryByRole("button", { name: "view more" })

    expect(toast).toBeInTheDocument()
    expect(toast).toHaveTextContent("🐶")
    expect(toast).toHaveTextContent("This is a toast message")
    expect(closeButton).toBeInTheDocument()
    expect(expandButton).not.toBeInTheDocument()

    const toastElement = screen.getByTestId("stToast")
    expect(toastElement).toBeInTheDocument()
    expect(toastElement).toHaveClass("stToast")
  })

  it("renders long toast messages with expand option when overflowing", () => {
    simulateOverflow()
    const props = getProps({ icon: "", body: LONG_MESSAGE })
    renderComponent(props)

    const toast = screen.getByRole("alertdialog")
    const expandButton = within(toast).getByRole("button", {
      name: "view more",
    })

    expect(toast).toBeInTheDocument()
    // Full text is always in the DOM — CSS line-clamp handles visual truncation
    expect(toast).toHaveTextContent(LONG_MESSAGE)
    expect(expandButton).toBeVisible()
  })

  it("can expand to see the full toast message & collapse", async () => {
    simulateOverflow()
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    const props = getProps({ icon: "", body: LONG_MESSAGE })
    renderComponent(props)

    const toast = screen.getByRole("alertdialog")
    const expandButton = within(toast).getByRole("button", {
      name: "view more",
    })
    expect(toast).toContainElement(expandButton)

    // Click view more button & expand the message
    await user.click(expandButton)
    act(() => {
      vi.runOnlyPendingTimers()
    })
    expect(toast).toHaveTextContent(LONG_MESSAGE)
    const collapseButton = within(toast).getByRole("button", {
      name: "view less",
    })
    expect(collapseButton).toBeVisible()

    // Click view less button & collapse the message
    await user.click(collapseButton)
    act(() => {
      vi.runOnlyPendingTimers()
    })
    expect(
      within(toast).getByRole("button", { name: "view more" })
    ).toBeVisible()
  })

  it("can close toast", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    const props = getProps()
    renderComponent(props)

    const toast = screen.getByRole("alertdialog")
    const closeButton = screen.getByRole("button", { name: "Close" })
    expect(toast).toBeInTheDocument()
    expect(closeButton).toBeInTheDocument()
    // Click close button
    await user.click(closeButton)
    act(() => {
      vi.runOnlyPendingTimers()
    })
    // Toast is removed synchronously after timer flush
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument()
  })

  it("auto hides based on duration seconds", () => {
    const props = getProps({ duration: 1 })
    renderComponent(props)

    const toast = screen.getByRole("alertdialog")
    expect(toast).toBeVisible()

    // Advance time just before auto hide
    act(() => {
      vi.advanceTimersByTime(900)
    })
    expect(screen.getByRole("alertdialog")).toBeVisible()

    // Cross the 1s threshold (Toast multiplies seconds by 1000)
    act(() => {
      vi.advanceTimersByTime(200)
    })

    // Toast is removed synchronously after timer flush
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument()
  })

  it("throws an error when called via st.sidebar.toast", () => {
    const props = getProps({})
    render(
      <ThemeProvider theme={{ ...mockTheme.emotion, inSidebar: true }}>
        {createContainer()}
        <Toast {...props} />
      </ThemeProvider>
    )

    const toastError = screen.getByRole("alert")
    expect(toastError).toBeInTheDocument()
    expect(toastError).toHaveTextContent("Streamlit API Error")
    // Should not add toast to queue when in sidebar
    expect(toastQueue.visibleToasts).toHaveLength(0)
  })

  it("does not show expand button for short messages", () => {
    const shortMessage = "This message should not be truncated."
    const props = getProps({ body: shortMessage })
    renderComponent(props)

    const toast = screen.getByRole("alertdialog")
    expect(toast).toHaveTextContent(shortMessage)
    expect(
      within(toast).queryByRole("button", { name: "view more" })
    ).not.toBeInTheDocument()
  })

  it("keeps the toast visible after the Toast component unmounts", () => {
    // The ToastRegion stays mounted (like AppView) while only the Toast element
    // unmounts, mirroring the stale-node cleanup that happens when st.rerun()
    // follows st.toast() (issue #7740). The toast must NOT be closed on unmount.
    const Wrapper = ({ showToast }: { showToast: boolean }): ReactElement => (
      <>
        {createContainer()}
        {showToast && <Toast {...getProps()} />}
      </>
    )

    const { rerender } = render(<Wrapper showToast={true} />)
    expect(screen.getByRole("alertdialog")).toBeVisible()

    rerender(<Wrapper showToast={false} />)
    expect(screen.getByRole("alertdialog")).toBeVisible()
  })

  it("de-dupes a second toast added with the same toastId", () => {
    // A rerun re-emits the same toast at the same delta path (the component is
    // keyed by scriptRunId, so it remounts). It must not stack a duplicate.
    render(
      <>
        {createContainer()}
        <Toast {...getProps({}, "event-0")} />
        <Toast {...getProps({}, "event-0")} />
      </>
    )

    expect(screen.getAllByRole("alertdialog")).toHaveLength(1)
  })

  describe("updating a toast in place (msg.toast(...))", () => {
    const UPDATED_BODY = "Ready!"

    it("replaces the visible toast's content when the element updates", () => {
      const { rerender } = renderComponent(
        getProps({ body: "Gathering ingredients...", icon: "" })
      )
      expect(screen.getByRole("alertdialog")).toHaveTextContent(
        "Gathering ingredients..."
      )

      rerender(
        <>
          {createContainer()}
          <Toast {...getProps({ body: "Cooking...", icon: "" })} />
        </>
      )
      rerender(
        <>
          {createContainer()}
          <Toast {...getProps({ body: UPDATED_BODY, icon: "🥞" })} />
        </>
      )

      const toasts = screen.getAllByRole("alertdialog")
      expect(toasts).toHaveLength(1)
      expect(toasts[0]).toHaveTextContent(UPDATED_BODY)
      expect(toasts[0]).toHaveTextContent("🥞")
      expect(toasts[0]).not.toHaveTextContent("Gathering ingredients...")
      expect(toasts[0]).not.toHaveTextContent("Cooking...")
    })

    it("does not add a toast when re-rendered with unchanged content", () => {
      const props = getProps()
      const { rerender } = renderComponent(props)
      const keyBefore = toastQueue.visibleToasts[0].key

      rerender(
        <>
          {createContainer()}
          <Toast {...getProps()} />
        </>
      )

      expect(toastQueue.visibleToasts).toHaveLength(1)
      expect(toastQueue.visibleToasts[0].key).toBe(keyBefore)
    })

    it("does not re-show a toast that was dismissed before the update", async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
      const { rerender } = renderComponent(getProps())

      await user.click(screen.getByRole("button", { name: "Close" }))
      act(() => {
        vi.runOnlyPendingTimers()
      })
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument()

      rerender(
        <>
          {createContainer()}
          <Toast {...getProps({ body: UPDATED_BODY })} />
        </>
      )

      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument()
    })

    it("does not re-show a toast that auto-hid before the update", () => {
      const { rerender } = renderComponent(getProps({ duration: 1 }))
      act(() => {
        vi.advanceTimersByTime(1_100)
      })
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument()

      rerender(
        <>
          {createContainer()}
          <Toast {...getProps({ body: UPDATED_BODY, duration: 1 })} />
        </>
      )

      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument()
    })

    it("applies the updated duration", () => {
      const { rerender } = renderComponent(getProps({ duration: 1 }))

      // duration=0 means the updated toast stays until dismissed
      rerender(
        <>
          {createContainer()}
          <Toast {...getProps({ body: UPDATED_BODY, duration: 0 })} />
        </>
      )
      act(() => {
        vi.advanceTimersByTime(5_000)
      })

      expect(screen.getByRole("alertdialog")).toHaveTextContent(UPDATED_BODY)
    })

    it("keeps the toast's identity and stack position", () => {
      const Wrapper = ({ body }: { body: string }): ReactElement => (
        <>
          {createContainer()}
          <Toast {...getProps({ body }, "event-0")} />
          <Toast {...getProps({ body: "Newer toast" }, "event-1")} />
        </>
      )
      const { rerender } = render(<Wrapper body="Cooking..." />)
      const keysBefore = toastQueue.visibleToasts.map(t => t.key)
      const textsBefore = screen
        .getAllByRole("alertdialog")
        .map(t => t.textContent)

      rerender(<Wrapper body={UPDATED_BODY} />)

      expect(toastQueue.visibleToasts.map(t => t.key)).toEqual(keysBefore)
      expect(
        screen.getAllByRole("alertdialog").map(t => t.textContent)
      ).toEqual(textsBefore.map(t => t?.replace("Cooking...", UPDATED_BODY)))
    })

    it("keeps an expanded toast expanded", async () => {
      simulateOverflow()
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
      const { rerender } = renderComponent(
        getProps({ icon: "", body: LONG_MESSAGE })
      )
      await user.click(screen.getByRole("button", { name: "view more" }))

      rerender(
        <>
          {createContainer()}
          <Toast {...getProps({ icon: "", body: `${LONG_MESSAGE}!` })} />
        </>
      )

      expect(screen.getByRole("alertdialog")).toHaveTextContent(
        `${LONG_MESSAGE}!`
      )
      expect(
        screen.getByRole("button", { name: "view less" })
      ).toBeInTheDocument()
    })

    it("restarts the timer on each update", () => {
      const { rerender } = renderComponent(getProps({ duration: 1 }))
      act(() => {
        vi.advanceTimersByTime(900)
      })

      rerender(
        <>
          {createContainer()}
          <Toast {...getProps({ body: UPDATED_BODY, duration: 1 })} />
        </>
      )
      act(() => {
        vi.advanceTimersByTime(900)
      })
      expect(screen.getByRole("alertdialog")).toHaveTextContent(UPDATED_BODY)

      act(() => {
        vi.advanceTimersByTime(200)
      })
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument()
    })

    it("auto-hides after updating an infinite toast to a timed one", () => {
      const { rerender } = renderComponent(getProps({ duration: 0 }))

      rerender(
        <>
          {createContainer()}
          <Toast {...getProps({ body: UPDATED_BODY, duration: 1 })} />
        </>
      )
      expect(screen.getByRole("alertdialog")).toHaveTextContent(UPDATED_BODY)

      act(() => {
        vi.advanceTimersByTime(1_100)
      })
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument()
    })

    it("only updates the toast with the matching toastId", () => {
      const Wrapper = ({ body }: { body: string }): ReactElement => (
        <>
          {createContainer()}
          <Toast {...getProps({ body: "Other toast" }, "event-0")} />
          <Toast {...getProps({ body }, "event-1")} />
        </>
      )
      const { rerender } = render(<Wrapper body="Cooking..." />)

      rerender(<Wrapper body={UPDATED_BODY} />)

      const toasts = screen.getAllByRole("alertdialog")
      expect(toasts).toHaveLength(2)
      expect(screen.getByText("Other toast")).toBeVisible()
      expect(screen.getByText(UPDATED_BODY)).toBeVisible()
      expect(screen.queryByText("Cooking...")).not.toBeInTheDocument()
    })
  })

  describe("re-emitting a toast at the same position in a new run", () => {
    // The Toast element is keyed by scriptRunId, so a new run remounts it.
    const renderRun = (
      runId: string,
      elementProps: Partial<ToastProto>
    ): ReactElement => (
      <>
        {createContainer()}
        <Toast key={runId} {...getProps(elementProps, "event-0")} />
      </>
    )

    it("restarts the visible toast with the new run's content", () => {
      const { rerender } = render(
        renderRun("run-1", { body: "Ready!", icon: "🥞" })
      )
      const keyBefore = toastQueue.visibleToasts[0].key

      rerender(
        renderRun("run-2", { body: "Gathering ingredients...", icon: "" })
      )

      const toasts = screen.getAllByRole("alertdialog")
      expect(toasts).toHaveLength(1)
      expect(toasts[0]).toHaveTextContent("Gathering ingredients...")
      expect(toasts[0]).not.toHaveTextContent("Ready!")
      expect(toastQueue.visibleToasts[0].key).toBe(keyBefore)
    })

    it("restarts the timer when the content differs", () => {
      const { rerender } = render(
        renderRun("run-1", { body: "Ready!", duration: 1 })
      )
      act(() => {
        vi.advanceTimersByTime(900)
      })

      rerender(renderRun("run-2", { body: "Gathering...", duration: 1 }))
      act(() => {
        vi.advanceTimersByTime(900)
      })
      expect(screen.getByRole("alertdialog")).toHaveTextContent("Gathering...")

      act(() => {
        vi.advanceTimersByTime(200)
      })
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument()
    })

    it("keeps the original timer when the content is identical", () => {
      // A toast re-emitted unchanged on every rerun still expires after its
      // duration instead of being kept alive by the reruns.
      const { rerender } = render(renderRun("run-1", { duration: 1 }))
      act(() => {
        vi.advanceTimersByTime(900)
      })

      rerender(renderRun("run-2", { duration: 1 }))
      expect(screen.getAllByRole("alertdialog")).toHaveLength(1)

      act(() => {
        vi.advanceTimersByTime(200)
      })
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument()
    })

    it("applies an icon-only change", () => {
      const { rerender } = render(renderRun("run-1", { icon: "🐶" }))

      rerender(renderRun("run-2", { icon: "🥞" }))

      const toast = screen.getByRole("alertdialog")
      expect(toast).toHaveTextContent("🥞")
      expect(toast).not.toHaveTextContent("🐶")
    })

    it("shows a new toast if the previous one was already closed", () => {
      const { rerender } = render(renderRun("run-1", { duration: 1 }))
      act(() => {
        vi.advanceTimersByTime(1_100)
      })
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument()

      rerender(renderRun("run-2", { body: "Gathering ingredients..." }))

      expect(screen.getByRole("alertdialog")).toHaveTextContent(
        "Gathering ingredients..."
      )
    })
  })

  it("shows separate toasts for distinct toastIds", () => {
    // Guards against over-eager de-duplication: two identical st.toast("Hip!")
    // calls live at distinct delta paths and must both be shown.
    render(
      <>
        {createContainer()}
        <Toast {...getProps({ body: "Hip!" }, "event-0")} />
        <Toast {...getProps({ body: "Hip!" }, "event-1")} />
      </>
    )

    expect(screen.getAllByRole("alertdialog")).toHaveLength(2)
  })
})
