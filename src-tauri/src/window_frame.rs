//! The main window's frame on macOS: the native traffic lights at a 20 pt
//! pitch in the 68 pt rail, and a remembered size that fits its screen. No
//! maximum is set, so full screen and tiling fill the screen.

use tauri::{LogicalSize, Window, WindowEvent};

/// The three-column minimum, as `minWidth` / `minHeight` in tauri.conf.json.
const MIN: (f64, f64) = (652.0, 600.0);

/// Left edge to left edge of neighbouring traffic lights (AppKit uses 23).
const PITCH: f64 = 20.0;

/// Where the minimise and zoom buttons go after a close button at `close`.
fn spaced(close: f64) -> [f64; 2] {
    [close + PITCH, close + 2.0 * PITCH]
}

/// The positions to move the other two buttons to, if AppKit reset them.
fn moves(close: f64, others: [f64; 2]) -> Option<[f64; 2]> {
    let target = spaced(close);
    (others != target).then_some(target)
}

/// A remembered size kept on its screen and never below the minimum.
fn within(size: (f64, f64), min: (f64, f64), screen: (f64, f64)) -> (f64, f64) {
    (
        size.0.min(screen.0).max(min.0),
        size.1.min(screen.1).max(min.1),
    )
}

/// Keeps the restored size on the window's screen and sets the traffic
/// light pitch; the remembered size was restored before this runs.
pub fn setup(window: &Window) {
    fit(window);
    respace(window);
}

/// AppKit puts the buttons back at its own pitch when the window resizes,
/// enters or leaves full screen, is tiled, changes appearance or screen.
pub fn on_event(window: &Window, event: &WindowEvent) {
    if let WindowEvent::Resized(_)
    | WindowEvent::Focused(_)
    | WindowEvent::ThemeChanged(_)
    | WindowEvent::ScaleFactorChanged { .. } = event
    {
        respace(window)
    }
}

fn fit(window: &Window) {
    let (Ok(Some(monitor)), Ok(inner), Ok(scale)) = (
        window.current_monitor(),
        window.inner_size(),
        window.scale_factor(),
    ) else {
        return;
    };
    let screen = monitor.size().to_logical::<f64>(monitor.scale_factor());
    let size = inner.to_logical::<f64>(scale);
    let kept = within(
        (size.width, size.height),
        MIN,
        (screen.width, screen.height),
    );
    if kept != (size.width, size.height) {
        let _ = window.set_size(LogicalSize::new(kept.0, kept.1));
    }
}

fn respace(window: &Window) {
    use objc2_app_kit::{NSWindow, NSWindowButton};
    let Ok(pointer) = window.ns_window() else {
        return;
    };
    // Window events and setup run on the AppKit thread; the window owns this pointer.
    let native = unsafe { &*pointer.cast::<NSWindow>() };
    let (Some(close), Some(minimise), Some(zoom)) = (
        native.standardWindowButton(NSWindowButton::CloseButton),
        native.standardWindowButton(NSWindowButton::MiniaturizeButton),
        native.standardWindowButton(NSWindowButton::ZoomButton),
    ) else {
        return;
    };
    let others = [minimise.frame().origin.x, zoom.frame().origin.x];
    if let Some(xs) = moves(close.frame().origin.x, others) {
        for (button, x) in [(minimise, xs[0]), (zoom, xs[1])] {
            let mut origin = button.frame().origin;
            origin.x = x;
            button.setFrameOrigin(origin);
        }
    }
}

#[cfg(test)]
#[path = "window_frame_tests.rs"]
mod tests;
