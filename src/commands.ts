import * as builder from 'botbuilder';
import { Conversation, ConversationState, Handoff } from './handoff';
const indexExports = require('./index');

export function commandsMiddleware(bot: builder.UniversalBot, handoff: Handoff) {
    return {
        botbuilder: (session: builder.Session, next: Function) => {
            if (session.message.type === 'message') {
                command(session, next, handoff, bot);
            } else {
                // allow messages of non 'message' type through 
                next();
            }
        }
    }
}

function command(session: builder.Session, next: Function, handoff: Handoff, bot: builder.UniversalBot) {
    if (handoff.isAgent(session)) {
        agentCommand(session, next, handoff, bot);
    } else {
        customerCommand(session, next, handoff);
    }
}

async function agentCommand(
    session: builder.Session,
    next: Function,
    handoff: Handoff,
    bot: builder.UniversalBot
) {

    const message = session.message;
    const conversation = await handoff.getConversation({ agentConversationId: message.address.conversation.id });
    const inputWords = message.text.split(' ');

    if (inputWords.length == 0)
        return;

    // Commands to execute whether connected to a customer or not
    if (inputWords[0] === 'options') {
        sendAgentCommandOptions(session);
        return;
    } else if (inputWords[0] === 'list') {
        session.send(await currentConversations(handoff));
        return;
    }
    // Commands to execute when not connected to a customer
 if (!conversation) {
        switch (inputWords[0]) {
            case 'connect':
                const newConversation = await handoff.connectCustomerToAgent(
                    inputWords.length > 1
                        ? { customerName: inputWords.slice(1).join(' ') }
                        : { bestChoice: true },
                    message.address
                );
                if (newConversation) {
                    session.send("You are connected to " + newConversation.customer.user.name);
                } else {
                    session.send("No customers waiting.");
                }
                break;
            default:
                sendAgentCommandOptions(session);
                break;
        }
        return;
    }

    if (conversation.state !== ConversationState.Agent) {
        // error state -- should not happen
        session.send("Shouldn't be in this state - agent should have been cleared out.");
        console.log("Shouldn't be in this state - agent should have been cleared out");
        return;
    }

    if (message.text === 'disconnect') {
        if (await handoff.connectCustomerToBot({ customerConversationId: conversation.customer.conversation.id })) {
            //Send message to agent
            session.send("Customer " + conversation.customer.user.name + " is now connected to the bot.");

            //Send message to customer
            var reply = new builder.Message()
                .address(conversation.customer)
                .text('Agent has disconnected, you are now speaking to the bot.');
            bot.send(reply);
        }
        return;
    }

    next();
}

async function customerCommand(session: builder.Session, next: Function, handoff: Handoff) {
    const message = session.message;   
    const customerStartHandoffCommandRegex = new RegExp("^" + indexExports._customerStartHandoffCommand + "$", "gi");
    if (customerStartHandoffCommandRegex.test(message.text)) {
        // lookup the conversation (create it if one doesn't already exist)
        const conversation = await handoff.getConversation({ customerConversationId: message.address.conversation.id }, message.address);
        if (conversation.state == ConversationState.Bot) {
            await handoff.addToTranscript({ customerConversationId: conversation.customer.conversation.id }, message);
            await handoff.queueCustomerForAgent({ customerConversationId: conversation.customer.conversation.id });
            session.endConversation("Connecting you to the next available agent.");
            return;
        }
    }
    return next();
}

function sendAgentCommandOptions(session: builder.Session) {
    const commands = ' ### Agent Options\n - Type *waiting* to connect to customer who has been waiting longest.\n - Type *connect { user name }* to connect to a specific conversation\n - Type *watch { user name }* to monitor a customer conversation\n - Type *history { user name }* to see a transcript of a given user\n - Type *list* to see a list of all current conversations.\n - Type *disconnect* while talking to a user to end a conversation.\n - Type *options* at any time to see these options again.';
    session.send(commands);
    return;
}

async function currentConversations(handoff: Handoff): Promise<string> {
    const conversations = await handoff.getCurrentConversations();
    if (conversations.length === 0) {
        return "No customers are in conversation.";
    }

    let text = '### Current Conversations \n';
    conversations.forEach(conversation => {
        const starterText = ' - *' + conversation.customer.user.name + '*';
        switch (ConversationState[conversation.state]) {
            case 'Bot':
                text += starterText + ' is talking to the bot\n';
                break;
            case 'Agent':
                text += starterText + ' is talking to an agent\n';
                break;
            case 'Waiting':
                text += starterText + ' is waiting to talk to an agent\n';
                break;
            case 'Watch':
                text += starterText + ' is being monitored by an agent\n';
                break;
        }
    });

    return text;
}

async function disconnectCustomer(conversation: Conversation, handoff: any, session: builder.Session) {
    if (await handoff.connectCustomerToBot({ customerConversationId: conversation.customer.conversation.id })) {
        session.send("Customer " + conversation.customer.user.name + " is now connected to the bot.");
    }

}
