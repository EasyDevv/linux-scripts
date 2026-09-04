use executor::{run_command, CliError};

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .with_writer(std::io::stderr)
        .init();

    let mut args = std::env::args().skip(1);
    let command = args.next();
    let rest: Vec<String> = args.collect();
    match run_command(command.as_deref(), rest).await {
        Ok(()) => {}
        Err(CliError { message, exit_code }) => {
            if !message.is_empty() {
                eprintln!("{message}");
            }
            std::process::exit(exit_code);
        }
    }
}
