package main

import (
	"encoding/xml"
	"fmt"
	"regexp"
	"strconv"
	"strings"
)

// Node is one uiautomator node, flattened in document order.
type Node struct {
	Text, Desc, ID, Class, Pkg              string
	X1, Y1, X2, Y2                          int
	Clickable, Checkable, Checked, Selected bool
	Focused, Scrollable, Disabled, Password bool
}

func (n Node) CX() int { return (n.X1 + n.X2) / 2 }
func (n Node) CY() int { return (n.Y1 + n.Y2) / 2 }

// Label is what a person reads on the node: its text, its content-desc, or both.
func (n Node) Label() string {
	switch {
	case n.Text != "" && n.Desc != "" && n.Text != n.Desc:
		return n.Text + " | " + n.Desc
	case n.Text != "":
		return n.Text
	default:
		return n.Desc
	}
}

type xmlNode struct {
	Attrs    []xml.Attr `xml:",any,attr"`
	Children []xmlNode  `xml:"node"`
}

var boundsRe = regexp.MustCompile(`^\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]$`)

// ParseDump reads a `uiautomator dump` hierarchy into its nodes, root first.
func ParseDump(raw string) ([]Node, error) {
	start := strings.Index(raw, "<hierarchy")
	end := strings.LastIndex(raw, "</hierarchy>")
	if start < 0 || end < 0 {
		return nil, fmt.Errorf("no hierarchy in the dump: %s", firstLine(raw))
	}
	var root struct {
		Children []xmlNode `xml:"node"`
	}
	dec := xml.NewDecoder(strings.NewReader(raw[start : end+len("</hierarchy>")]))
	dec.Strict = false
	if err := dec.Decode(&root); err != nil {
		return nil, fmt.Errorf("unreadable dump: %v", err)
	}
	var out []Node
	var walk func(xs []xmlNode)
	walk = func(xs []xmlNode) {
		for _, x := range xs {
			out = append(out, toNode(x))
			walk(x.Children)
		}
	}
	walk(root.Children)
	return out, nil
}

func toNode(x xmlNode) Node {
	var n Node
	for _, a := range x.Attrs {
		v := a.Value
		switch a.Name.Local {
		case "text":
			n.Text = strings.TrimSpace(v)
		case "content-desc":
			n.Desc = strings.TrimSpace(v)
		case "resource-id":
			n.ID = v
		case "class":
			n.Class = v
		case "package":
			n.Pkg = v
		case "clickable":
			n.Clickable = v == "true"
		case "checkable":
			n.Checkable = v == "true"
		case "checked":
			n.Checked = v == "true"
		case "selected":
			n.Selected = v == "true"
		case "focused":
			n.Focused = v == "true"
		case "scrollable":
			n.Scrollable = v == "true"
		case "enabled":
			n.Disabled = v == "false"
		case "password":
			n.Password = v == "true"
		case "bounds":
			if m := boundsRe.FindStringSubmatch(v); m != nil {
				n.X1, _ = strconv.Atoi(m[1])
				n.Y1, _ = strconv.Atoi(m[2])
				n.X2, _ = strconv.Atoi(m[3])
				n.Y2, _ = strconv.Atoi(m[4])
			}
		}
	}
	return n
}

// Signature changes when anything a person could see changes; equal twice in a row means settled.
func Signature(nodes []Node) string {
	var b strings.Builder
	for _, n := range nodes {
		fmt.Fprintf(&b, "%s\x00%s\x00%d,%d,%d,%d\x00%t%t%t\n", n.Text, n.Desc, n.X1, n.Y1, n.X2, n.Y2, n.Checked, n.Selected, n.Focused)
	}
	return b.String()
}

// Shown keeps the nodes worth a line: labeled ones, plus unlabeled checkboxes and edit fields.
func Shown(nodes []Node, all bool) []Node {
	var out []Node
	for _, n := range nodes {
		if n.X2 <= n.X1 || n.Y2 <= n.Y1 {
			continue
		}
		if all || n.Label() != "" || n.Checkable || strings.HasSuffix(n.Class, "EditText") {
			out = append(out, n)
		}
	}
	return out
}

func shortClass(c string) string {
	if i := strings.LastIndex(c, "."); i >= 0 {
		return c[i+1:]
	}
	return c
}

// Line is one node as the agent reads it: label, the point to tap, class, flags.
func Line(n Node) string {
	var flags []string
	if n.Clickable {
		flags = append(flags, "clk")
	}
	if n.Checkable {
		if n.Checked {
			flags = append(flags, "checked")
		} else {
			flags = append(flags, "unchecked")
		}
	}
	if n.Selected {
		flags = append(flags, "sel")
	}
	if n.Focused {
		flags = append(flags, "focus")
	}
	if n.Scrollable {
		flags = append(flags, "scroll")
	}
	if n.Disabled {
		flags = append(flags, "off")
	}
	label := n.Label()
	if label == "" {
		label = "·"
	}
	label = strings.ReplaceAll(label, "\n", "⏎")
	s := fmt.Sprintf("%s  (%d,%d)  %s", label, n.CX(), n.CY(), shortClass(n.Class))
	if len(flags) > 0 {
		s += "  " + strings.Join(flags, ",")
	}
	return s
}

// Find returns the nodes whose label matches q: exact matches first, then (unless exact) substrings.
func Find(nodes []Node, q string, exact bool) []Node {
	var hit, part []Node
	for _, n := range Shown(nodes, false) {
		switch {
		case n.Text == q || n.Desc == q:
			hit = append(hit, n)
		case !exact && (strings.Contains(n.Text, q) || strings.Contains(n.Desc, q)):
			part = append(part, n)
		}
	}
	return append(hit, part...)
}

// Focused is the focused edit field, if any.
func Focused(nodes []Node) (Node, bool) {
	for _, n := range nodes {
		if n.Focused && strings.HasSuffix(n.Class, "EditText") {
			return n, true
		}
	}
	for _, n := range nodes {
		if n.Focused {
			return n, true
		}
	}
	return Node{}, false
}

// Labels is a one-line list of what is on screen, for a not-found message.
func Labels(nodes []Node, max int) string {
	var ls []string
	for _, n := range Shown(nodes, false) {
		if l := n.Label(); l != "" {
			ls = append(ls, strings.ReplaceAll(l, "\n", " "))
		}
		if len(ls) == max {
			ls = append(ls, "…")
			break
		}
	}
	return strings.Join(ls, " · ")
}

func firstLine(s string) string {
	s = strings.TrimSpace(s)
	if i := strings.IndexByte(s, '\n'); i >= 0 {
		s = s[:i]
	}
	if len(s) > 160 {
		s = s[:160] + "…"
	}
	return s
}
