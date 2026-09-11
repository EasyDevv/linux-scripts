import type { Component } from "svelte";
import Bell from "@lucide/svelte/icons/bell";
import BellOff from "@lucide/svelte/icons/bell-off";
import Book from "@lucide/svelte/icons/book";
import Box from "@lucide/svelte/icons/box";
import Calendar from "@lucide/svelte/icons/calendar";
import Circle from "@lucide/svelte/icons/circle";
import CircleAlert from "@lucide/svelte/icons/circle-alert";
import CircleCheck from "@lucide/svelte/icons/circle-check";
import CircleDashed from "@lucide/svelte/icons/circle-dashed";
import CircleDot from "@lucide/svelte/icons/circle-dot";
import CircleX from "@lucide/svelte/icons/circle-x";
import Clock from "@lucide/svelte/icons/clock";
import Columns3 from "@lucide/svelte/icons/columns-3";
import Copy from "@lucide/svelte/icons/copy";
import Ellipsis from "@lucide/svelte/icons/ellipsis";
import File from "@lucide/svelte/icons/file";
import FilePlus from "@lucide/svelte/icons/file-plus";
import FileText from "@lucide/svelte/icons/file-text";
import FolderKanban from "@lucide/svelte/icons/folder-kanban";
import Hash from "@lucide/svelte/icons/hash";
import Keyboard from "@lucide/svelte/icons/keyboard";
import Layers from "@lucide/svelte/icons/layers";
import LayoutGrid from "@lucide/svelte/icons/layout-grid";
import Link from "@lucide/svelte/icons/link";
import List from "@lucide/svelte/icons/list";
import LogOut from "@lucide/svelte/icons/log-out";
import MessageSquare from "@lucide/svelte/icons/message-square";
import Monitor from "@lucide/svelte/icons/monitor";
import Settings from "@lucide/svelte/icons/settings";
import Signal from "@lucide/svelte/icons/signal";
import SlidersHorizontal from "@lucide/svelte/icons/sliders-horizontal";
import Sparkles from "@lucide/svelte/icons/sparkles";
import SquareCheck from "@lucide/svelte/icons/square-check";
import Star from "@lucide/svelte/icons/star";
import Trash from "@lucide/svelte/icons/trash";
import Undo2 from "@lucide/svelte/icons/undo-2";
import UserPlus from "@lucide/svelte/icons/user-plus";
import Users from "@lucide/svelte/icons/users";

const icons: Record<string, Component> = {
	bell: Bell,
	"bell-off": BellOff,
	book: Book,
	box: Box,
	calendar: Calendar,
	circle: Circle,
	"circle-alert": CircleAlert,
	"circle-check": CircleCheck,
	"circle-dashed": CircleDashed,
	"circle-dot": CircleDot,
	"circle-x": CircleX,
	clock: Clock,
	"columns-3": Columns3,
	copy: Copy,
	ellipsis: Ellipsis,
	file: File,
	"file-plus": FilePlus,
	"file-text": FileText,
	"folder-kanban": FolderKanban,
	hash: Hash,
	keyboard: Keyboard,
	layers: Layers,
	"layout-grid": LayoutGrid,
	link: Link,
	list: List,
	"log-out": LogOut,
	"message-square": MessageSquare,
	monitor: Monitor,
	settings: Settings,
	signal: Signal,
	"sliders-horizontal": SlidersHorizontal,
	sparkles: Sparkles,
	"square-check": SquareCheck,
	star: Star,
	trash: Trash,
	"undo-2": Undo2,
	"user-plus": UserPlus,
	users: Users,
};

export function iconOf(name: string | undefined): Component | undefined {
	if (!name) return undefined;
	return icons[name];
}
