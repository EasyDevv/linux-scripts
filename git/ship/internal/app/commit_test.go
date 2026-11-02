package app

import "testing"

// TestPlanCommit covers commit()'s default message builder.
func TestPlanCommit(t *testing.T) {
	cases := []struct {
		name    string
		numstat string
		flag    string
		want    commitPlan
	}{
		{
			name:    "clean tree",
			numstat: "  \n\n",
			want:    commitPlan{Notice: "nothing to commit, working tree clean"},
		},
		{
			name:    "binary only",
			numstat: "-\t-\tlogo.png\n-\t-\tbin/tool\n",
			want:    commitPlan{Notice: "nothing to commit (only binary files changed)"},
		},
		{
			name:    "single file",
			numstat: "1\t2\tinternal/app/run.go\n",
			want:    commitPlan{Message: "run.go"},
		},
		{
			name: "five files keep order by total",
			numstat: "1\t0\ta/one.go\n" +
				"2\t0\ta/two.go\n" +
				"3\t0\ta/three.go\n" +
				"4\t0\ta/four.go\n" +
				"5\t0\ta/five.go\n",
			want: commitPlan{Message: "five.go, four.go, three.go, two.go, one.go"},
		},
		{
			name: "seven files name the top five and the rest",
			numstat: "10\t0\ta/one.go\n" +
				"9\t0\ta/two.go\n" +
				"8\t0\ta/three.go\n" +
				"7\t0\ta/four.go\n" +
				"6\t0\ta/five.go\n" +
				"1\t0\ta/six.go\n" +
				"1\t0\ta/seven.go\n",
			want: commitPlan{Message: "one.go, two.go, three.go, four.go, five.go and 2 others"},
		},
		{
			name: "six files singular other",
			numstat: "10\t0\ta/one.go\n" +
				"9\t0\ta/two.go\n" +
				"8\t0\ta/three.go\n" +
				"7\t0\ta/four.go\n" +
				"6\t0\ta/five.go\n" +
				"1\t0\ta/six.go\n",
			want: commitPlan{Message: "one.go, two.go, three.go, four.go, five.go and 1 other"},
		},
		{
			name:    "added plus deleted ranks",
			numstat: "0\t5\tbig.go\n5\t0\tsmall.go\n",
			want:    commitPlan{Message: "big.go, small.go"},
		},
		{
			name:    "flag message wins",
			numstat: "1\t0\ta/one.go\n",
			flag:    "  Fix login redirect  ",
			want:    commitPlan{Message: "Fix login redirect"},
		},
		{
			name:    "blank flag message falls back",
			numstat: "1\t0\ta/one.go\n",
			flag:    "   ",
			want:    commitPlan{Message: "one.go"},
		},
		{
			name:    "malformed lines are skipped",
			numstat: "not-a-line\n1\t0\ta/ok.go\n",
			want:    commitPlan{Message: "ok.go"},
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := planCommit(tc.numstat, tc.flag); got != tc.want {
				t.Fatalf("planCommit(%.30q) = %+v, want %+v", tc.numstat, got, tc.want)
			}
		})
	}
}

func TestTruthyScript(t *testing.T) {
	for raw, want := range map[string]bool{
		`"exit 0"`: true,
		`""`:       false,
		`null`:     false,
		`false`:    false,
		`0`:        false,
	} {
		if got := truthy([]byte(raw)); got != want {
			t.Fatalf("truthy(%s) = %v, want %v", raw, got, want)
		}
	}
}
