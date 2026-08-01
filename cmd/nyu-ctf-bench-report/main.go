package main

import (
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"strings"

	"github.com/MilkSU-Official/milksu/internal/evalbench"
)

const maximumRunRecordSize = 1 << 20

type repeatedPaths []string

func (paths *repeatedPaths) String() string {
	return strings.Join(*paths, ",")
}

func (paths *repeatedPaths) Set(value string) error {
	value = strings.TrimSpace(value)
	if value == "" {
		return errors.New("run record path cannot be empty")
	}
	*paths = append(*paths, value)
	return nil
}

func main() {
	if err := run(os.Args[1:], os.Stdout); err != nil {
		fmt.Fprintln(os.Stderr, "nyu-ctf-bench-report:", err)
		os.Exit(1)
	}
}

func run(arguments []string, stdout io.Writer) error {
	flags := flag.NewFlagSet("nyu-ctf-bench-report", flag.ContinueOnError)
	flags.SetOutput(io.Discard)

	root := flags.String("root", "", "path to the pinned NYU CTF Bench checkout")
	splitName := flags.String("split", string(evalbench.SplitDevelopment), "development or test")
	output := flags.String("out", "", "optional report path; defaults to stdout")
	var runPaths repeatedPaths
	flags.Var(&runPaths, "run", "summary RunRecord JSON path; may be repeated")
	if err := flags.Parse(arguments); err != nil {
		return err
	}
	if flags.NArg() != 0 {
		return fmt.Errorf("unexpected positional arguments: %s", strings.Join(flags.Args(), " "))
	}
	if strings.TrimSpace(*root) == "" {
		return errors.New("-root is required")
	}

	split := evalbench.Split(*splitName)
	catalog, err := evalbench.ImportNYUCTFBenchCatalog(*root, split)
	if err != nil {
		return err
	}
	runs := make([]evalbench.RunRecord, 0, len(runPaths))
	for _, runPath := range runPaths {
		data, err := readBounded(runPath, maximumRunRecordSize)
		if err != nil {
			return fmt.Errorf("read run record %q: %w", runPath, err)
		}
		record, err := evalbench.DecodeRunRecord(data)
		if err != nil {
			return fmt.Errorf("load run record %q: %w", runPath, err)
		}
		runs = append(runs, record)
	}

	report, err := evalbench.Aggregate([]evalbench.Catalog{catalog}, runs)
	if err != nil {
		return err
	}
	encoded, err := evalbench.EncodeReport(report)
	if err != nil {
		return err
	}
	if strings.TrimSpace(*output) == "" {
		_, err = stdout.Write(encoded)
		return err
	}
	return os.WriteFile(*output, encoded, 0o600)
}

func readBounded(path string, limit int64) ([]byte, error) {
	file, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer file.Close()

	data, err := io.ReadAll(io.LimitReader(file, limit+1))
	if err != nil {
		return nil, err
	}
	if int64(len(data)) > limit {
		return nil, fmt.Errorf("file exceeds %d bytes", limit)
	}
	return data, nil
}
