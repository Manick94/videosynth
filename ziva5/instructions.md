System Validation for CSPL customers
1.	System Validation for CSPL customers
Existing flow: 
Currently, the Customer code can be changed in ZIVA for offline PL cases. Due to this, the loans are being booked in different name other than to the individual to whom the offer was issued. There is no parent and child loan mapping established in current system. The tenure is being checked only during offer generation and there is no system level check to cross verify the eligibility condition.

Enhancements :
System level check is implemented for the below listed scenarios to avoid discrepancies in customer identity and multiple disbursals for the same customer.
•	The customer will not be changed which can be handled in dedupe functionality (existing customer)
•	To avoid multiple child loans for the parent loan, the child loan must be mapped to the respective parent loan.
•	The Tenure eligibility will be checked for the parent loan before creating the sanction/ trigging the DIY link for child loan
   Customer primary Info- Dedupe Functionality (Existing Customer)
•	When the user does the dedupe, customer code and all other fields can be prefilled with the value and displayed to the user. in the dedupe window.
•	All fields in dedupe screen will be freezed and kept non-editable.

ziva1.png

Tenure Eligibility Check:
Applicable for OL,OF,PL,L3,L4 products

ziva2.png


ziva3.png






Parent and Child Loan dedupe
Applicable for OL,OF,PL,L3,L4 products
•	If the system attempts to creates a second child loan to the parent loan with an existing child loan is already disbursed to the customer, the system must alert with the deviation to restrict multiple child loans.

ziva4.png

ziva5.png

