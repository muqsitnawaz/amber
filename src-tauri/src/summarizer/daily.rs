use crate::config::SummarizerConfig;
use crate::error::AmberError;
use crate::summarizer::provider::{LlmProvider, Message, OpenAICompatibleProvider};

pub struct DailySummarizer;

impl DailySummarizer {
    pub async fn generate(
        date: &str,
        events: Vec<String>,
        config: &SummarizerConfig,
    ) -> Result<String, AmberError> {
        let provider = OpenAICompatibleProvider {
            api_base: config.api_base.clone(),
            model: config.model.clone(),
            api_key_env: config.api_key_env.clone(),
        };

        let events_text = events.join("\n");

        let system_prompt = format!(
            "You are a personal knowledge assistant. Generate a daily development note for {}.\n\
             Format the note as markdown with YAML frontmatter.\n\n\
             Frontmatter must include: date, topics (list), people (list).\n\n\
             Use these section headings (only include sections with content):\n\
             - Shipped: completed features/fixes\n\
             - Worked On: in-progress work\n\
             - Decisions: technical decisions made\n\
             - Discovered: new tools, techniques, insights\n\
             - Links: relevant URLs from commits/events\n\
             - People: collaborators and their contributions\n\
             - Events: meetings, reviews, discussions\n\n\
             Rules:\n\
             - Use concrete references (commit hashes, file names, branch names)\n\
             - No fluff or filler text\n\
             - Be concise but specific",
            date
        );

        let messages = vec![
            Message::system(system_prompt),
            Message::user(format!(
                "Here are the raw events for {}:\n\n{}",
                date, events_text
            )),
        ];

        provider.complete(messages).await
    }
}
