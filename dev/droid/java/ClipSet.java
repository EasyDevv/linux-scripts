import android.content.ClipData;
import android.util.Base64;
import java.lang.reflect.Method;

/**
 * adb 셸에서 폰 클립보드에 글자를 넣는다. `input text` 는 한글을 못 쓰고, 폰에 앱을 깔지 않으려고 app_process 로 돈다.
 * 호출: app_process -cp /data/local/tmp/clipset.dex /system/bin ClipSet <base64>
 */
public final class ClipSet {
	public static void main(String[] args) throws Exception {
		String text = new String(Base64.decode(args[0], Base64.DEFAULT), "UTF-8");
		Class<?> manager = Class.forName("android.os.ServiceManager");
		Object binder = manager.getMethod("getService", String.class).invoke(null, "clipboard");
		Class<?> stub = Class.forName("android.content.IClipboard$Stub");
		Object service = stub.getMethod("asInterface", android.os.IBinder.class).invoke(null, binder);
		ClipData clip = ClipData.newPlainText("macro", text);
		for (Method method : service.getClass().getMethods()) {
			if (!method.getName().equals("setPrimaryClip")) continue;
			Class<?>[] types = method.getParameterTypes();
			Object[] values = new Object[types.length];
			int strings = 0;
			for (int i = 0; i < types.length; i++) {
				if (types[i] == ClipData.class) values[i] = clip;
				else if (types[i] == String.class) values[i] = strings++ == 0 ? "com.android.shell" : null;
				else if (types[i] == int.class) values[i] = 0;
				else if (types[i] == boolean.class) values[i] = false;
			}
			method.invoke(service, values);
			System.out.println("ok");
			return;
		}
		throw new IllegalStateException("setPrimaryClip 을 못 찾았어요");
	}
}
