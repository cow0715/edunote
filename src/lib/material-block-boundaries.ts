export const materialListStart = /^(?:[•●○◆■□▶▪▫‣∙·※]|[-–—]\s|\d{1,3}[.)]\s)/u
export const materialNoticeField = /^(?:From|To|Dates?(?:\s*(?:&|and)\s*Times?)?|(?:Start |End )?Time|Subject|Location|Venue|Deadline|Participants|Production Company|Participation Fee|Age|Capacity|Reserve Your Spot|Results Announcement|Please Note|Note|Requirements|Email|Phone|Step \d+)\s*:/iu
export const materialGreeting = /^(?:Dear\s.+[,!:]|To whom it may concern[,!:]|(?:Hi|Hello)\b.*[,!]|.*님께)$/iu
export const materialClosing = /^(?:(?:Best|Warm|Kind) regards|Sincerely|Yours(?: sincerely| faithfully| truly)?|Regards)(?:[,.](?:\s+.+)?)?$|^.*(?:드림|올림)$/iu
export const materialBoldHeading = /^(?:(?:[•●○◆■□▶▪▫‣∙·※–—-]|\d+[.)])\s*)?(?:(?:<(?:strong|b)>[^<\n]+<\/(?:strong|b)>|\*\*[^*\n]+\*\*)[ \t]*)+$/iu
