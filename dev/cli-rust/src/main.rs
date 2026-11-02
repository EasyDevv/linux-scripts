fn main() {
    if let Err(error) = cli::run() {
        if error.help {
            cli::print_help();
        } else {
            eprintln!("error: {error:#}");
        }
        std::process::exit(error.code);
    }
}
