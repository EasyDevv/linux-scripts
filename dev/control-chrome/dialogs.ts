export type DialogCdp = {
	send(
		method: string,
		params?: Record<string, unknown>,
		timeoutMs?: number,
	): Promise<unknown>;
	on(event: string, fn: (...args: unknown[]) => void): void;
};

const DIALOG_COMMAND_TIMEOUT_MS = 400;
const DISARM_BEFOREUNLOAD = `(() => {
	try { window.onbeforeunload = null; } catch {}
	window.addEventListener("beforeunload", (event) => {
		event.stopImmediatePropagation();
		event.preventDefault();
		event.returnValue = "";
	}, true);
	return true;
})()`;

async function sendOrNull(
	cdp: DialogCdp,
	method: string,
	params: Record<string, unknown> = {},
	timeoutMs = DIALOG_COMMAND_TIMEOUT_MS,
) {
	return await Promise.race([
		cdp.send(method, params, timeoutMs).catch(() => null),
		Bun.sleep(timeoutMs).then(() => null),
	]);
}

export function installDialogAutoAccept(cdp: DialogCdp) {
	cdp.on("Page.javascriptDialogOpening", () => {
		void sendOrNull(cdp, "Page.handleJavaScriptDialog", { accept: true });
	});
}

export async function enableDialogAutoAccept(cdp: DialogCdp) {
	installDialogAutoAccept(cdp);
	const enabled = await sendOrNull(cdp, "Page.enable");
	if (enabled === null) return false;
	await sendOrNull(cdp, "Page.handleJavaScriptDialog", { accept: true });
	return true;
}

export async function disarmBeforeUnload(cdp: DialogCdp) {
	await sendOrNull(cdp, "Runtime.evaluate", {
		expression: DISARM_BEFOREUNLOAD,
		returnByValue: true,
	});
}

export async function preparePageLeave(cdp: DialogCdp) {
	if (!(await enableDialogAutoAccept(cdp))) return false;
	await disarmBeforeUnload(cdp);
	return true;
}

export async function closePageAllowingDialogs(cdp: DialogCdp) {
	const prepared = await preparePageLeave(cdp);
	await sendOrNull(cdp, "Page.close");
	return prepared;
}
