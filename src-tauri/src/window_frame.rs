//! The main window's frame on macOS: the native traffic lights at a 20 pt
//! pitch in the 68 pt rail, and a size between the three-column minimum and
//! four fifths of the screen.

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

/// The largest window on a screen of `screen` logical points.
fn largest(screen: (f64, f64), min: (f64, f64)) -> (f64, f64) {
    (
        (screen.0 * 0.8).floor().max(min.0),
        (screen.1 * 0.8).floor().max(min.1),
    )
}

/// A size clamped between `min` and `max`.
fn within(size: (f64, f64), min: (f64, f64), max: (f64, f64)) -> (f64, f64) {
    (size.0.clamp(min.0, max.0), size.1.clamp(min.1, max.1))
}

/// Applies the limits for the window's screen and the traffic light pitch;
/// the remembered size was restored before this runs.
pub fn setup(window: &Window) {
    limit(window);
    respace(window);
}

/// AppKit puts the buttons back at its own pitch when the window resizes,
/// enters or leaves full screen, is tiled or changes appearance; a new
/// screen brings new limits.
pub fn on_event(window: &Window, event: &WindowEvent) {
    match event {
        WindowEvent::Moved(_) | WindowEvent::ScaleFactorChanged { .. } => {
            limit(window);
            respace(window);
        }
        WindowEvent::Resized(_) | WindowEvent::Focused(_) | WindowEvent::ThemeChanged(_) => {
            respace(window)
        }
        _ => {}
    }
}

fn limit(window: &Window) {
    let (Ok(Some(monitor)), Ok(scale)) = (window.current_monitor(), window.scale_factor()) else {
        return;
    };
    let screen = monitor.size().to_logical::<f64>(monitor.scale_factor());
    let max = largest((screen.width, screen.height), MIN);
    let _ = window.set_max_size(Some(LogicalSize::new(max.0, max.1)));
    let Ok(inner) = window.inner_size() else {
        return;
    };
    let size = inner.to_logical::<f64>(scale);
    let kept = within((size.width, size.height), MIN, max);
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
