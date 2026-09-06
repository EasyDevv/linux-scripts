fn main() {
    if let Err(error) = provider_usage::run() {
        eprintln!("error: {error:#}");
        std::process::exit(1);
    }
}
