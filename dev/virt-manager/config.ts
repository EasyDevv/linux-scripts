import { join } from "node:path";

function envInt(name: string, fallback: number): number {
	const value = process.env[name];
	if (!value) return fallback;
	const parsed = Number.parseInt(value, 10);
	if (!Number.isFinite(parsed) || parsed <= 0) {
		throw new Error(`${name} must be a positive integer`);
	}
	return parsed;
}

const home = process.env.HOME ?? "/home/easydev";

export interface VmConfig {
	name: string;
	user: string;
	password: string;
	memoryMiB: number;
	vcpus: number;
	diskGiB: number;
	baseIp: string;
	baseMac: string;
	uri: string;
	network: string;
	isoPath: string;
	imagesDir: string;
	diskPath: string;
	publicKeyPath: string;
	hostSharedDir: string;
	guestSharedDir: string;
	virtiofsTag: string;
	storagePool: string;
	goldenPath: string;
}

export function loadConfig(
	name = process.env.VM_NAME ?? "debian13-kde-podman",
): VmConfig {
	const imagesDir = process.env.VM_IMAGES_DIR ?? join(home, ".vm-images");
	return {
		name,
		user: process.env.VM_USER ?? "easydev",
		password: process.env.VM_PASSWORD ?? "virtuser",
		memoryMiB: envInt("VM_MEMORY_MIB", 8192),
		vcpus: envInt("VM_VCPUS", 4),
		diskGiB: envInt("VM_DISK_GIB", 80),
		baseIp: process.env.VM_IP ?? "192.168.122.63",
		baseMac: process.env.VM_MAC ?? "52:54:00:8a:31:bd",
		uri: process.env.LIBVIRT_URI ?? "qemu:///system",
		network: process.env.LIBVIRT_NETWORK ?? "default",
		isoPath:
			process.env.ISO_PATH ??
			join(home, ".iso", "debian-13.6.0-amd64-DVD-1.iso"),
		imagesDir,
		diskPath: process.env.DISK_PATH ?? join(imagesDir, `${name}.qcow2`),
		publicKeyPath:
			process.env.SSH_PUBLIC_KEY_PATH ?? join(home, ".ssh", "vm_ed25519.pub"),
		hostSharedDir: process.env.HOST_SHARED_DIR ?? join(home, ".vm-shared"),
		guestSharedDir:
			process.env.GUEST_SHARED_DIR ??
			join("/home", process.env.VM_USER ?? "easydev", "shared"),
		virtiofsTag: process.env.VIRTIOFS_TAG ?? "vm-shared",
		storagePool: process.env.STORAGE_POOL ?? "vm-images",
		goldenPath:
			process.env.GOLDEN_PATH ?? join(imagesDir, "debian13-kde-golden.qcow2"),
	};
}
