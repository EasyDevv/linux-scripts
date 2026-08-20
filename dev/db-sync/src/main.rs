fn main() {
    if let Err(error) = db_sync::run() {
        eprintln!("error: {error:#}");
        std::process::exit(1);
    }
}
