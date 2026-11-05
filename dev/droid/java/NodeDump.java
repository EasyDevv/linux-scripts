import android.app.UiAutomation;
import android.graphics.Rect;
import android.view.accessibility.AccessibilityNodeInfo;
import java.io.File;
import java.io.FileOutputStream;
import java.util.concurrent.TimeoutException;

/**
 * The on-screen accessibility tree as uiautomator XML, without uiautomator's wait for an idle
 * screen ("could not get idle state" on a clock, a video, a spinner). Runs from adb shell, no app:
 *
 * one shot: app_process -cp /system/framework/uiautomator.jar:/data/local/tmp/droid-nodes.dex /system/bin NodeDump
 * resident: ... NodeDump serve DIR IDLE_S
 *   droid creates DIR/req; the server writes the tree to DIR/out, so one dump is one adb round trip
 *   with the UiAutomation connection made once. It ends after IDLE_S without a request, or when DIR
 *   is gone, so a dead PC leaves nothing behind on the phone.
 * Build: see build-dex.sh.
 */
public final class NodeDump {
	public static void main(String[] args) throws Exception {
		Class<?> w = Class.forName("com.android.uiautomator.core.UiAutomationShellWrapper");
		Object wrapper = w.getConstructor().newInstance();
		w.getMethod("connect").invoke(wrapper);
		try {
			UiAutomation ua = (UiAutomation) w.getMethod("getUiAutomation").invoke(wrapper);
			if (args.length >= 3 && args[0].equals("serve")) {
				serve(ua, new File(args[1]), Integer.parseInt(args[2]));
			} else {
				System.out.println(dump(ua));
			}
		} finally {
			w.getMethod("disconnect").invoke(wrapper);
		}
	}

	/**
	 * One dump per DIR/req: write the tree to DIR/out.tmp and rename it, so the reader never sees half
	 * a dump. Exit on IDLE_S without a request or when DIR is removed.
	 */
	private static void serve(UiAutomation ua, File dir, int idleSec) throws Exception {
		File req = new File(dir, "req");
		File out = new File(dir, "out");
		File tmp = new File(dir, "out.tmp");
		long last = System.currentTimeMillis();
		while (dir.isDirectory() && System.currentTimeMillis() - last < idleSec * 1000L) {
			if (!req.delete()) {
				Thread.sleep(20);
				continue;
			}
			last = System.currentTimeMillis();
			FileOutputStream f = new FileOutputStream(tmp);
			try {
				f.write(dump(ua).getBytes("UTF-8"));
			} finally {
				f.close();
			}
			tmp.renameTo(out);
		}
	}

	private static String dump(UiAutomation ua) throws Exception {
		// A resident connection fixes its node cache only from events: after a scroll the old
		// positions and visibility stay and list cards drop out (261105: 26~28 of 32 cards, never
		// the same ones). Clear the cache before every dump (API 34+); refresh the root otherwise.
		try {
			UiAutomation.class.getMethod("clearCache").invoke(ua);
		} catch (NoSuchMethodException ignored) {
			// older phones: root.refresh() below still re-reads the tree
		}
		try {
			ua.waitForIdle(200, 1200); // a short settle when the screen allows one
		} catch (TimeoutException ignored) {
			// never idle: read the tree as it is now
		}
		AccessibilityNodeInfo root = null;
		for (int i = 0; i < 10 && root == null; i++) {
			root = ua.getRootInActiveWindow();
			if (root == null) Thread.sleep(150);
		}
		if (root == null) return "ERROR: no active window";
		root.refresh();
		StringBuilder sb = new StringBuilder(64 * 1024);
		sb.append("<?xml version='1.0' encoding='UTF-8' standalone='yes' ?><hierarchy rotation=\"0\">");
		node(sb, root, 0);
		sb.append("</hierarchy>");
		return sb.toString();
	}

	private static void node(StringBuilder sb, AccessibilityNodeInfo n, int index) {
		if (n == null || !n.isVisibleToUser()) return;
		Rect r = new Rect();
		n.getBoundsInScreen(r);
		sb.append("<node index=\"").append(index).append('"');
		attr(sb, "text", n.getText());
		attr(sb, "resource-id", n.getViewIdResourceName());
		attr(sb, "class", n.getClassName());
		attr(sb, "package", n.getPackageName());
		attr(sb, "content-desc", n.getContentDescription());
		flag(sb, "checkable", n.isCheckable());
		flag(sb, "checked", n.isChecked());
		flag(sb, "clickable", n.isClickable());
		flag(sb, "enabled", n.isEnabled());
		flag(sb, "focusable", n.isFocusable());
		flag(sb, "focused", n.isFocused());
		flag(sb, "scrollable", n.isScrollable());
		flag(sb, "long-clickable", n.isLongClickable());
		flag(sb, "password", n.isPassword());
		flag(sb, "selected", n.isSelected());
		sb.append(" bounds=\"[").append(r.left).append(',').append(r.top).append("][")
				.append(r.right).append(',').append(r.bottom).append("]\">");
		for (int i = 0; i < n.getChildCount(); i++) node(sb, n.getChild(i), i);
		sb.append("</node>");
	}

	private static void attr(StringBuilder sb, String k, CharSequence v) {
		sb.append(' ').append(k).append("=\"");
		if (v != null) {
			for (int i = 0; i < v.length(); i++) {
				char c = v.charAt(i);
				switch (c) {
					case '&': sb.append("&amp;"); break;
					case '<': sb.append("&lt;"); break;
					case '>': sb.append("&gt;"); break;
					case '"': sb.append("&quot;"); break;
					case '\n': sb.append("&#10;"); break;
					default: if (c >= 0x20 || c == '\t') sb.append(c);
				}
			}
		}
		sb.append('"');
	}

	private static void flag(StringBuilder sb, String k, boolean v) {
		sb.append(' ').append(k).append("=\"").append(v).append('"');
	}
}
